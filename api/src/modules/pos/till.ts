import { Hono } from "hono";
import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";
import { withSession, type Session } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { PoolClient as Client } from "pg";
/* The banquet service's rule for which functions an order may go on
   (D17-21) — through its front door, never its files. */
import { whyNotAttachable } from "../banquet/index.ts";
import {
  overCashLimit, panFor, CASH_REFUND_CEILING, categoryProblem, putExpensePhoto, serveExpensePhoto,
} from "../finance/index.ts";
/* The one way an outlet row is made (Restaurant setup, D22-6). */
import { addOutlet } from "./pos.ts";
import {
  numberedFor, nameWithAddons, priceWithAddons, lineAddons,
  type NumberedChoice, type LineAddons,
} from "./numberedAddons.ts";
import { extrasFor, insertExtras, type ExtraInput } from "./extras.ts";
/* The KOT section of Restaurant setup (D27-292): kinds, computers, routing,
   the bill printer. Registered below, behind the module gate. */
import { registerKotSection, deviceOf } from "./kotSection.ts";
import { registerTenderChanges, tenderChanges } from "./tenderChanges.ts";
import { registerPosRequests } from "./posRequests.ts";
import { registerOwnerAllowance, allowancePlan, setDiscount, maySettleAllowance, SETTLE_REFUSED,
  type AllowancePlan } from "./ownerAllowance.ts";
import { registerTableMoves } from "./tableMoves.ts";
import { phoneProblem, priceProblem } from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TILL — the POS built into the PMS

   pos.ts is the BRIDGE: an outside till presents a key and posts a
   finished bill. This is the PMS's own till, and every route here is
   PERSON-facing — a waiter with a session, not a machine with a key.

   THE RULE THAT SHAPES THIS FILE

   Settling to a room does NOT write a folio posting of its own. It
   goes through the same door an outside POS uses: a pos_tickets row
   carrying the posting. The in-house till gets no privileged path to
   the ledger, which means the idempotency, the one-room-two-guests
   refusal and the append-only posting were all built and tested
   before this file existed.

   A CASH sale never touches a folio and so never creates a ticket.
   pos_tickets stays what its comment says — bills that reached a
   guest folio. pos_orders is the complete sales record.
   ══════════════════════════════════════════════════════════════════ */

export const till = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

/** A price a person TYPED: a number, or a string holding one, zero or
    more. Null for a blank, a null or a word — never zero. `Number("")`
    and `Number(null)` are both 0, which is how a dish added with an
    empty price box landed on the menu at ₹0.00 (POS-14). */
function typedPrice(raw: unknown): number | null {
  const text = typeof raw === "number" ? String(raw)
    : typeof raw === "string" ? raw.replace(/[,\s₹]/g, "") : "";
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const NO_PRICE =
  "Type a price, or tick Free. A blank is not zero.";

/** The hotel this route is about, or null if the code is unknown. */
async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The module gate ──────────────────────────────────────────────
   Not every property has a restaurant. HIDING THE SCREEN IS NOT
   DISABLING IT — a hidden nav entry is still a URL anybody can type,
   and the endpoint behind it would answer happily.

   So the API refuses independently of the interface, which is the
   shape Rule 6 asks for everywhere: the screen shows the reason, and
   the server does not rely on the screen having shown it.

   Absent means ENABLED. A property that never had a row keeps its
   till, because turning something off is an act somebody performs and
   never a side effect of a deploy. */
till.use("/:code/till/*", moduleGate);
till.use("/:code/kitchen", moduleGate);
till.use("/:code/kitchen/*", moduleGate);

/* ── Reception on the POS ─────────────────────────────────────────
   The owner's decision of 14 September: a per-hotel switch, set by the
   GM, decides whether Reception may use the till. Until then the till
   never asked anybody's role, so a receptionist always could.

   Enforced HERE as well as in the navigation, for the reason the module
   gate above gives: a hidden menu entry is still a URL. Every role but
   Reception — and a group administrator — is answered as before;
   app.may_use_pos (087) is the one definition. */
till.use("/:code/till/*", receptionGate);
till.use("/:code/kitchen", receptionGate);
till.use("/:code/kitchen/*", receptionGate);

registerKotSection(till, hotelFor);
/* A paid bill's payment mode changed before the night audit (D27-363). */
registerTenderChanges(till, hotelFor);
/* A waiter sends the GM what they may not do themselves (D27-363). */
registerPosRequests(till, hotelFor);
/* The owner's restaurant allowance (D27-355, D27-366). */
registerOwnerAllowance(till, hotelFor);
/* Moving an order to another table, and joining two tables (D27-370). */
registerTableMoves(till, hotelFor);

async function receptionGate(
  c: Context<{ Variables: { subject: string } }>,
  next: Next,
) {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "No such property." }, 404);

  const allowed = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const { rows } = await client.query<{ ok: boolean }>(
      "select app.may_use_pos($1) as ok", [hotelId]);
    return rows[0]!.ok;
  });

  if (allowed === null) return c.json({ error: "No such property." }, 404);
  if (!allowed) {
    return c.json(refuse(
      "Reception is not set up to use the point of sale at this property. " +
      "The general manager can turn it on in the property's settings."), 403);
  }
  await next();
}

async function moduleGate(
  c: Context<{ Variables: { subject: string } }>,
  next: Next,
) {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "No such property." }, 404);

  const allowed = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const { rows } = await client.query<{ enabled: boolean }>(
      `select app.module_enabled($1, 'pos') as enabled`, [hotelId]);
    return rows[0]!.enabled;
  });

  if (allowed === null) return c.json({ error: "No such property." }, 404);
  if (!allowed) {
    return c.json(refuse(
      "This property has no point of sale. Turn it on in the property's " +
      "settings if that is wrong."), 403);
  }
  await next();
}

/* ── May I use the POS here? ──────────────────────────────────────
   Answers ok only by getting past BOTH gates above — the module and
   the reception switch. The screens ask this before drawing, because
   their data calls turned every failure into an empty list, and a
   refused receptionist was told "There is no menu yet" instead of why
   they were refused (14 September). Those calls throw now and each
   screen names its own failure (POS-4, 16 September); this still
   answers first, once, for the whole service. */
till.get("/:code/till/access", (c) => c.json({ ok: true as const }));

/* ── The menu ─────────────────────────────────────────────────────── */

/* THE GST A DISH IS RUNG AT: its own rate, else its section's rule for
   its price - null when neither is set. Written ONCE, for `i` a menu item
   and `c` its category: `addOneLine` copies it onto the line, and the
   menu read shows it, so a screen cannot print a rate the bill does not
   charge. It sent the dish's own column, and `Number(null)` printed "0%"
   for a dish that follows its section (POS-15, D21-94). */
const DISH_TAX_RATE = `coalesce(
  i.tax_rate,
  app.gst_rate_or_null(i.hotel_id, coalesce(c.tax_kind, 'other'), i.price))`;

till.get("/:code/till/menu", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      category_id: string; category: string; tax_kind: string | null;
      id: string | null;
      name: string | null; price: string | null; tax_rate: string | null;
      is_active: boolean | null; sort_order: number;
      short_code: string | null; is_veg: boolean | null;
      is_favourite: boolean | null; off_until: string | null;
      off_reason: string | null;
      prep_minutes: number | null;
      own_prep_minutes: number | null;
      category_prep_minutes: number | null;
      course: number | null;
      own_course: number | null;
      category_course: number | null;
    }>(
      /* Left join, so a category with nothing in it still appears.
         A kitchen that has created "Desserts" and not filled it needs
         to see the empty shelf, not wonder where it went. */
      `select c.id::text as category_id, c.name as category, c.tax_kind,
              i.id::text, i.name, i.price::text,
              ${DISH_TAX_RATE}::text as tax_rate,
              i.is_active, coalesce(i.sort_order, 0) as sort_order,
              i.short_code, i.is_veg, i.is_favourite,
              i.off_until::text, i.off_reason,
              /* THE RESOLVED TIME, from the one place the fallback is
                 written. Its parts come too, because the screen that
                 sets these has to show whether a number is this dish's
                 own or its category's - otherwise clearing a dish's
                 time looks like it did nothing. */
              app.prep_minutes(i.id) as prep_minutes,
              i.prep_minutes         as own_prep_minutes,
              c.prep_minutes         as category_prep_minutes,
              app.course_of(i.id)    as course,
              i.course               as own_course,
              c.course               as category_course
         from pos_menu_categories c
         left join pos_menu_items i on i.category_id = c.id
        where c.hotel_id = $1 and c.is_active
          /* A Bar person sees only the bar's dishes (D27-324): the menu's
             Bar tab, whichever KOT it prints on (D27-329 (1), 225). Their
             empty sections go with the rest. */
          and (not app.pos_bar_only($1) or app.pos_dish_at_bar($1, i.id))
        order by c.sort_order, c.name, i.sort_order, i.name`,
      [hotelId],
    );

    const byCategory = new Map<string, {
      id: string; name: string;
      /** The tax heading it sells under (D22-4). Null is not set: a dish
          in it with no rate of its own cannot be rung. */
      taxKind: string | null;
      /** The default for everything in it. Null means nobody has said. */
      prepMinutes: number | null;
      /** Which course everything in here belongs to. Null is not part of
          a sequence — a drink — and is not course zero. */
      course: number | null;
      items: {
        id: string; name: string; price: number;
        /** The rate it is rung at. Null is "none set" - a dash on
            screen, never 0%. A real 0 stays 0. */
        taxRate: number | null;
        isActive: boolean; shortCode: string | null;
        isVeg: boolean | null; isFavourite: boolean;
        offUntil: string | null; offReason: string | null;
        /** Resolved: this dish's own time, else its category's, else
            NULL — which means untimed, and must show as a dash. Zero
            would tell a kitchen the dish is instant. */
        prepMinutes: number | null;
        /** Set on the dish itself, so a screen can tell "3 minutes,
            chosen here" from "3 minutes, inherited". */
        ownPrepMinutes: number | null;
        course: number | null;
        ownCourse: number | null;
        variations: {
          id: string; label: string; price: number;
          typeNo: number; kind: string | null; heading: string | null;
        }[];
        addonGroups: {
          id: string; label: string; minSelect: number; maxSelect: number | null;
          addons: { id: string; label: string; price: number; offUntil: string | null }[];
        }[];
      }[];
    }>();

    for (const r of rows) {
      let cat = byCategory.get(r.category_id);
      if (!cat) {
        cat = {
          id: r.category_id, name: r.category, taxKind: r.tax_kind,
          prepMinutes: r.category_prep_minutes,
          course: r.category_course, items: [],
        };
        byCategory.set(r.category_id, cat);
      }
      if (r.id && r.name) {
        cat.items.push({
          id: r.id,
          name: r.name,
          price: Number(r.price),
          taxRate: r.tax_rate === null ? null : Number(r.tax_rate),
          isActive: r.is_active ?? false,
          shortCode: r.short_code,
          /* NULL is a real answer: nobody has said whether this is veg,
             and the third state must not render as the green mark. */
          isVeg: r.is_veg,
          isFavourite: r.is_favourite ?? false,
          offUntil: r.off_until,
          offReason: r.off_reason,
          prepMinutes: r.prep_minutes,
          ownPrepMinutes: r.own_prep_minutes,
          course: r.course,
          ownCourse: r.own_course,
          variations: [],
          addonGroups: [],
        });
      }
    }

    /* Variations and add-ons in two more queries rather than a join that
       multiplies rows. A dish with two variations and four sides would
       come back eight times, and the reassembly is then the thing that
       has a bug in it. */
    const { rows: variations } = await client.query<{
      item_id: string; id: string; label: string; price: string;
      type_no: number; kind: string | null; heading: string | null;
    }>(
      `select v.item_id::text, v.id::text, v.label, v.price::text,
              v.type_no, v.kind, v.heading
         from pos_item_variations v
         join pos_menu_items i on i.id = v.item_id
        where i.hotel_id = $1 and v.is_active
        order by v.type_no, v.sort_order, v.price`,
      [hotelId],
    );

    const { rows: addons } = await client.query<{
      item_id: string; group_id: string; group_label: string;
      min_select: number; max_select: number | null;
      id: string; label: string; price: string; off_until: string | null;
    }>(
      `select ig.item_id::text, g.id::text as group_id, g.label as group_label,
              g.min_select, g.max_select,
              a.id::text, a.label, a.price::text, a.off_until::text
         from pos_item_addon_groups ig
         join pos_addon_groups g on g.id = ig.group_id
         join pos_addons a on a.group_id = g.id
        where g.hotel_id = $1 and a.is_active
        order by ig.sort_order, g.label, a.sort_order, a.label`,
      [hotelId],
    );

    const items = new Map(
      [...byCategory.values()].flatMap((c2) => c2.items.map((i) => [i.id, i] as const)),
    );

    for (const v of variations) {
      /* Its type (D27-192): type 1 carries the dish's price, a later one
         adds to it. Added fields, so a menu cached before them reads every
         choice as type 1, as it was. */
      items.get(v.item_id)?.variations.push({
        id: v.id, label: v.label, price: Number(v.price),
        typeNo: v.type_no, kind: v.kind, heading: v.heading,
      });
    }

    for (const a of addons) {
      const item = items.get(a.item_id);
      if (!item) continue;
      let group = item.addonGroups.find((g) => g.id === a.group_id);
      if (!group) {
        group = {
          id: a.group_id, label: a.group_label,
          minSelect: a.min_select, maxSelect: a.max_select, addons: [],
        };
        item.addonGroups.push(group);
      }
      group.addons.push({
        id: a.id, label: a.label, price: Number(a.price),
        offUntil: a.off_until,
      });
    }

    return { categories: [...byCategory.values()] };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/till/menu/categories", async (c) => {
  type CategoryBody = { name?: string; sortOrder?: number };
  const input = await c.req.json<CategoryBody>()
    .catch(() => ({}) as CategoryBody);
  const name = input.name?.trim();
  if (!name) return c.json(refuse("A category needs a name."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_menu_categories (hotel_id, name, sort_order)
       values ($1,$2,$3)
       on conflict (hotel_id, name) do update set is_active = true
       returning id::text`,
      [hotelId, name, input.sortOrder ?? 0],
    );
    return { ok: true as const, id: rows[0]!.id, name };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

till.post("/:code/till/menu/items", async (c) => {
  type ItemBody = {
    categoryId?: string; name?: string; price?: unknown; taxRate?: number;
    free?: boolean;
  };
  const input = await c.req.json<ItemBody>().catch(() => ({}) as ItemBody);

  const name = input.name?.trim();
  if (!name) return c.json(refuse("An item needs a name."), 409);
  if (!input.categoryId) {
    return c.json(refuse("Which part of the menu does this belong to?"), 409);
  }

  /* A price of zero is legitimate — a complimentary welcome drink still
     goes on the bill at nil. A NEGATIVE one is not, and neither is a
     blank pretending to be one: this read `Number(input.price)`, and a
     blank or a null is 0 to Number (POS-14). */
  const price = typedPrice(input.price);
  if (price === null) return c.json(refuse(NO_PRICE), 409);
  /* POS-5, X-1 (D27-120): a dish at ₹0.00 went on sale without a word. */
  const zeroDish = priceProblem(price, input.free === true);
  if (zeroDish) return c.json(refuse(zeroDish), 409);

  /* ⚠ THIS WAS `Number(input.taxRate ?? 5)`.
     A shipped tax rate, in a project whose first rule is that nothing
     ships a price. Every item added through the interface got 5%
     whether or not anybody had decided that, and a bar built on it
     would have billed its whisky at the restaurant's rate in silence.
     067 removed the same default from the column; this was the other
     half of it, in the code path people actually use.

     Undefined now means FOLLOW THE CATEGORY'S RULE, which is what
     almost every item wants. An explicit number stays available for
     the real exception — bottled water on a food bill. */
  const taxRate = input.taxRate === undefined || input.taxRate === null
    ? null : Number(input.taxRate);
  if (taxRate !== null
      && (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100)) {
    return c.json(refuse("A tax rate must be between 0 and 100."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
       values ($1,$2,$3,$4,$5)
       on conflict (hotel_id, category_id, name)
         do update set price = excluded.price,
                       tax_rate = excluded.tax_rate,
                       is_active = true
       returning id::text`,
      [hotelId, input.categoryId, name, price, taxRate],
    );
    return { ok: true as const, id: rows[0]!.id, name, price, taxRate };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});


/* ══════════════════════════════════════════════════════════════════
   IMPORTING A MENU

   A real card is two hundred dishes across a dozen sections, and typing
   it into a dialog one at a time is not a thing anybody will do. So it
   arrives as a file.

   TWO PASSES, ALWAYS. `dryRun` validates every row and reports what
   WOULD happen, changing nothing. The screen shows that, and only then
   is the same payload sent again to apply. A bulk write that happens the
   instant a file is chosen is how somebody replaces a menu they meant
   to look at first.

   THE ROW IS REJECTED, NEVER REPAIRED. No price means the row does not
   land — it does not land at zero. An unknown tax heading means the row
   does not land — it does not land at five percent. The whole reason
   this system shows a dash instead of a zero is that a filled-in blank
   is indistinguishable from a decision once it is in the database, and
   an import is where a thousand of them would arrive at once.

   RE-IMPORTING IS AN UPDATE. The unique key is (hotel, category, name),
   so sending the same file twice corrects prices rather than doubling
   the card — which is what somebody actually does with a spreadsheet:
   fix a column, send it again.
   ══════════════════════════════════════════════════════════════════ */

interface ImportRow {
  category?: string;
  name?: string;
  /* One row per variation (the owner's D21-43, 21 September): Chicken
     Biryani is two rows, Half and Full, each with its own price. Blank
     on a dish sold at one price. */
  variation?: string;
  price?: string | number;
  taxKind?: string;
  taxRate?: string | number;
  veg?: string | boolean;
  shortCode?: string;
  /* Groups made by the add-ons file, named: "Choice of bread; Preferences".
     Attached, never detached - taking one off is the Menu screen's. */
  addonGroups?: string;
}

interface Verdict {
  line: number;
  name: string;
  action: "create" | "update" | "rejected";
  detail: string;
}

const MENU_TAX_KINDS = ["restaurant", "bar", "banquet", "other"];

/* A section may also sell under "alcohol" (VAT, D21-91), but only where the
   property is switched on for it (D21-90): on the Menu screen's heading
   picker (D22-4) and in the import (D22-46). Asked before anything is
   written - a refusal after a write inside withSession keeps the write
   (root MEMORY 243). */
async function servesAlcohol(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ on: boolean }>(
    "select app.module_enabled($1, 'alcohol') as on", [hotelId]);
  return rows[0]?.on === true;
}

const NOT_SERVING_ALCOHOL =
  "Alcohol is a heading only where this property serves alcohol. The owner "
  + "or an administrator turns it on in Settings, under Modules.";

till.post("/:code/till/menu/import", async (c) => {
  const input = await c.req.json<{ rows?: ImportRow[]; dryRun?: boolean }>()
    .catch(() => ({}) as { rows?: ImportRow[]; dryRun?: boolean });

  const rows = input.rows ?? [];
  const dryRun = input.dryRun !== false;

  if (rows.length === 0) {
    return c.json(refuse("There are no rows in that file."), 409);
  }
  if (rows.length > 2000) {
    return c.json(refuse(
      `That file has ${rows.length} rows. Two thousand is the limit - a menu `
      + "longer than that is almost always a column mismatch."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Everything that already exists, read once. Asking per row turns a
       two-hundred-line import into four hundred queries. */
    const { rows: existing } = await client.query<{
      category: string; name: string; variations: string[];
    }>(
      `select c.name as category, i.name,
              coalesce(array_agg(v.label) filter (where v.id is not null),
                       '{}') as variations
         from pos_menu_items i
         join pos_menu_categories c on c.id = i.category_id
         left join pos_item_variations v on v.item_id = i.id and v.is_active
        where i.hotel_id = $1
        group by c.name, i.name`,
      [hotelId],
    );
    const key = (cat: string, name: string) =>
      `${cat.toLowerCase()}|${name.toLowerCase()}`;
    /* dish → its variations on the menu now, lower case → as spelled. */
    const already = new Map(existing.map((r) => [
      key(r.category, r.name),
      new Map(r.variations.map((v) => [v.toLowerCase(), v])),
    ]));

    const { rows: groupRows } = await client.query<{ id: string; label: string }>(
      "select id::text, label from pos_addon_groups where hotel_id = $1",
      [hotelId],
    );
    const groupIdOf = new Map(groupRows.map((g) => [g.label.toLowerCase(), g.id]));

    const alcohol = await servesAlcohol(client, hotelId);
    const kinds = alcohol ? [...MENU_TAX_KINDS, "alcohol"] : MENU_TAX_KINDS;

    /* Which dishes have a variation row ANYWHERE in the file, so a row
       without one is refused whichever comes first. */
    const sizedInFile = new Set(
      rows.filter((r) => String(r.variation ?? "").trim())
        .map((r) => key(String(r.category ?? "").trim(),
                        String(r.name ?? "").trim())));

    const verdicts: Verdict[] = [];
    const seen = new Set<string>();
    /* One entry per dish, its variations gathered from its rows. The
       dish's other columns are read from the first row that fills them. */
    const good = new Map<string, {
      category: string; name: string; price: number | null;
      taxKind: string | null; taxRate: number | null;
      veg: boolean | null; shortCode: string | null;
      variations: { label: string; price: number }[];
      groupIds: Set<string>;
    }>();

    rows.forEach((raw, i) => {
      const line = i + 2;                    // +1 zero-based, +1 for the header
      const name = String(raw.name ?? "").trim();
      const category = String(raw.category ?? "").trim();
      const reject = (detail: string) => {
        verdicts.push({
          line, name: name || "(no name)", action: "rejected", detail,
        });
      };

      if (!name && !category) return;        // a blank line in the file
      if (!name) return reject("No dish name.");
      if (!category) return reject("No section - which part of the menu?");

      /* A PRICE IS REQUIRED AND IS NEVER DEFAULTED.
         A blank price is the commonest thing in a hand-made spreadsheet
         and the most dangerous: a dish that lands at zero looks priced. */
      const rawPrice = String(raw.price ?? "").trim();
      if (rawPrice === "") return reject("No price. A blank is not zero.");
      const price = Number(rawPrice.replace(/[,\s₹]/g, ""));
      if (!Number.isFinite(price) || price < 0) {
        return reject(`"${rawPrice}" is not a price.`);
      }
      /* X-1 (D27-120): a file cannot tick Free. */
      if (price === 0) {
        return reject("0 is not taken from a file. Add a free dish on the menu screen, ticked Free.");
      }

      const kindRaw = String(raw.taxKind ?? "").trim().toLowerCase();
      if (kindRaw === "alcohol" && !alcohol) return reject(NOT_SERVING_ALCOHOL);
      if (kindRaw && !kinds.includes(kindRaw)) {
        return reject(
          `"${raw.taxKind}" is not a tax heading. Use `
          + `${kinds.join(", ")}.`);
      }

      /* An explicit rate is the exception, not the rule. Blank means
         follow the section's heading, which is right for nearly every
         dish and is why the column is optional. */
      const rateRaw = String(raw.taxRate ?? "").trim().replace("%", "");
      let taxRate: number | null = null;
      if (rateRaw !== "") {
        taxRate = Number(rateRaw);
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
          return reject(`"${raw.taxRate}" is not a GST percentage.`);
        }
      }

      const vegRaw = String(raw.veg ?? "").trim().toLowerCase();
      let veg: boolean | null = null;
      if (vegRaw !== "") {
        if (["yes", "y", "veg", "true", "1"].includes(vegRaw)) veg = true;
        else if (["no", "n", "non-veg", "nonveg", "false", "0"].includes(vegRaw)) veg = false;
        else return reject(`"${raw.veg}" is not yes or no.`);
      }

      /* A dish sold by variation has no price of its own to set (045):
         a row without a variation would change a number nobody is
         charged, and look as if it had worked. */
      const variation = String(raw.variation ?? "").trim();
      const k = key(category, name);
      const onMenu = already.get(k);
      if (!variation && sizedInFile.has(k)) {
        return reject(`"${name}" has variations in this file, so a row `
          + "without one has nothing to price.");
      }
      if (!variation && onMenu && onMenu.size > 0) {
        return reject(`"${name}" is sold by variation. Give this row a `
          + "variation, or remove the variations on the Menu screen first.");
      }

      /* The same dish (or variation) twice in one file is worth naming:
         the second would overwrite the first and nobody would know which
         price won. */
      const rowKey = `${k}|${variation.toLowerCase()}`;
      if (seen.has(rowKey)) {
        return reject(variation
          ? `"${name} (${variation})" appears twice in this file.`
          : `"${name}" appears twice under ${category} in this file.`);
      }

      const groupNames = String(raw.addonGroups ?? "").split(";")
        .map((g) => g.trim()).filter(Boolean);
      const unknownGroup = groupNames.find((g) => !groupIdOf.has(g.toLowerCase()));
      if (unknownGroup) {
        return reject(`"${unknownGroup}" is not an add-on group yet. Import `
          + "the add-ons file first, or make the group on the Menu screen.");
      }
      seen.add(rowKey);

      const label = onMenu?.get(variation.toLowerCase()) ?? variation;
      const isUpdate = variation ? onMenu?.has(variation.toLowerCase()) === true
                                 : onMenu !== undefined;
      verdicts.push({
        line,
        name: variation ? `${name} (${label})` : name,
        action: isUpdate ? "update" : "create",
        detail: isUpdate
          ? `${category} · price becomes ${price}`
          : `${category} · ${price}`,
      });

      const dish = good.get(k) ?? {
        category, name, price: null, taxKind: null, taxRate: null,
        veg: null, shortCode: null, variations: [], groupIds: new Set<string>(),
      };
      good.set(k, dish);
      if (variation) dish.variations.push({ label, price });
      else dish.price = price;
      dish.taxKind ??= kindRaw || null;
      dish.taxRate ??= taxRate;
      dish.veg ??= veg;
      dish.shortCode ??= String(raw.shortCode ?? "").trim() || null;
      for (const g of groupNames) dish.groupIds.add(groupIdOf.get(g.toLowerCase())!);
    });

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: verdicts.filter((v) => v.action === "update").length,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };

    if (dryRun) {
      return { ok: true as const, dryRun: true, verdicts, ...tally };
    }

    /* ── Apply ─────────────────────────────────────────────────────
       Rejected rows are simply absent. Refusing a whole file because one
       line has a typo makes somebody edit two hundred rows to fix one;
       silently repairing the typo is worse. The good rows land, the bad
       ones are listed, and the file can be corrected and sent again —
       which updates rather than duplicates. */
    for (const row of good.values()) {
      const { rows: cat } = await client.query<{ id: string }>(
        `insert into pos_menu_categories (hotel_id, name, tax_kind)
         values ($1, $2, $3)
         on conflict (hotel_id, name) do update
           set tax_kind  = coalesce(excluded.tax_kind,
                                    pos_menu_categories.tax_kind),
               is_active = true
         returning id::text`,
        [hotelId, row.category, row.taxKind],
      );

      /* A dish sold by variation still needs a price of its own - the
         column cannot be empty - and it is never charged while it has
         variations (045's trigger; addOneLine). A new one takes its
         first variation's; one already on the menu keeps what it has.
         Removing its last variation asks for a price (the owner, 21 Sep). */
      const sized = row.variations.length > 0;
      const { rows: item } = await client.query<{ id: string }>(
        `insert into pos_menu_items
           (hotel_id, category_id, name, price, tax_rate, is_veg, short_code)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (hotel_id, category_id, name) do update
           set price      = case when $8::boolean then pos_menu_items.price
                                 else excluded.price end,
               tax_rate   = excluded.tax_rate,
               is_veg     = coalesce(excluded.is_veg, pos_menu_items.is_veg),
               short_code = coalesce(excluded.short_code,
                                     pos_menu_items.short_code),
               is_active  = true
         returning id::text`,
        [hotelId, cat[0]!.id, row.name, row.price ?? row.variations[0]!.price,
         row.taxRate, row.veg, row.shortCode, sized],
      );

      for (const [i, v] of row.variations.entries()) {
        await client.query(
          `insert into pos_item_variations
             (hotel_id, item_id, label, price, sort_order)
           values ($1,$2,$3,$4,$5)
           on conflict (item_id, type_no, label) do update
             set price = excluded.price, is_active = true`,
          [hotelId, item[0]!.id, v.label, v.price, i + 1],
        );
      }
      for (const groupId of row.groupIds) {
        await client.query(
          `insert into pos_item_addon_groups (item_id, group_id)
           values ($1,$2) on conflict do nothing`,
          [item[0]!.id, groupId],
        );
      }
    }

    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ══════════════════════════════════════════════════════════════════
   HOW LONG A DISH TAKES

   Two addresses, because the fallback has two ends: a category default
   for the two hundred dishes nobody will time one at a time, and a dish
   that differs from its category.

   ⚠ NULL CLEARS, AND THAT IS A REAL ACT. Sending `null` means "nobody
   has said", which is not the same as zero and not the same as leaving
   the field alone. A dish cleared back to null falls through to its
   category again — which is why the menu returns the resolved time AND
   the dish's own, so a screen can show which is which.

   The range is checked by the database (1..480). It is not re-checked
   here: a second copy of that rule is a second place for it to be
   wrong, and the constraint's refusal is already a sentence.
   ══════════════════════════════════════════════════════════════════ */

/** Minutes from a request body: a number, or null to clear. `undefined`
    is refused rather than treated as a clear — a screen that forgot to
    send the field would otherwise silently wipe a time somebody set. */
function minutesOrNull(raw: unknown): number | null | "bad" {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  return "bad";
}

/* ══════════════════════════════════════════════════════════════════
   WHICH COURSE A DISH BELONGS TO

   ⚠ THIS EXISTED IN THE DATABASE AND ON THE PASS FOR AN HOUR WITH NO
   WAY TO SET IT. Migration 081 added the columns, the kitchen feed read
   them, and the by-table view grouped by them — and nothing anywhere
   could write one, so every dish would have read "Any time" forever
   unless somebody ran SQL by hand. That is defect 81's shape, found in
   my own work by an audit looking for it in everybody else's.

   Same two addresses and the same rules as the preparation times: null
   clears and falls back, a missing field is refused, and the range is
   checked by the database rather than restated here.
   ══════════════════════════════════════════════════════════════════ */

/** A course from a request body: a number, or null to clear. */
function courseOrNull(raw: unknown): number | null | "bad" {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  return "bad";
}

till.post("/:code/till/menu/items/:id/course", async (c) => {
  const input = await c.req.json<{ course?: unknown }>()
    .catch(() => ({} as { course?: unknown }));
  const course = courseOrNull(input.course);
  if (course === "bad") {
    return c.json(refuse(
      "Which course? A whole number from 1, or null to clear it and use "
      + "the category's.",
    ), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ name: string }>(
      `update pos_menu_items set course = $3, updated_at = now()
        where id = $1 and hotel_id = $2
        returning name`,
      [c.req.param("id"), hotelId, course],
    );
    if (!rows[0]) return { ok: false as const, reason: "No such dish." };

    /* A second statement, for the reason defect 202 records: a function
       called inside RETURNING re-queries the table and still sees the
       pre-update row. */
    const { rows: now } = await client.query<{ course: number | null }>(
      "select app.course_of($1) as course", [c.req.param("id")],
    );

    return {
      ok: true as const,
      name: rows[0].name,
      course: now[0]?.course ?? null,
      ownCourse: course,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.post("/:code/till/menu/categories/:id/course", async (c) => {
  const input = await c.req.json<{ course?: unknown }>()
    .catch(() => ({} as { course?: unknown }));
  const course = courseOrNull(input.course);
  if (course === "bad") {
    return c.json(refuse(
      "Which course? A whole number from 1, or null to take this category "
      + "out of the sequence - which is what a drink wants.",
    ), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ name: string }>(
      `update pos_menu_categories set course = $3, updated_at = now()
        where id = $1 and hotel_id = $2
        returning name`,
      [c.req.param("id"), hotelId, course],
    );
    if (!rows[0]) return { ok: false as const, reason: "No such category." };

    /* How many dishes this actually moved — the ones that had no course
       of their own. A default that changes nothing is worth saying. */
    const { rows: moved } = await client.query<{ n: string }>(
      `select count(*)::text as n from pos_menu_items
        where category_id = $1 and hotel_id = $2 and course is null`,
      [c.req.param("id"), hotelId],
    );

    return {
      ok: true as const,
      name: rows[0].name,
      course,
      dishesAffected: Number(moved[0]!.n),
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* THE TAX HEADING A SECTION SELLS UNDER, from the Menu screen (D22-4).
   Until 23 September only a re-import could set it, so a section made on
   the Menu screen had none and its dishes could not be rung. The import's
   headings, and alcohol where the property serves it. No "not set": nothing
   asked for one, and a section without a heading sells nothing. */
till.post("/:code/till/menu/categories/:id/tax-kind", async (c) => {
  const input = await c.req.json<{ kind?: unknown }>()
    .catch(() => ({} as { kind?: unknown }));
  const kind = String(input.kind ?? "");
  if (![...MENU_TAX_KINDS, "alcohol"].includes(kind)) {
    return c.json(refuse(
      `Which heading? ${MENU_TAX_KINDS.join(", ")}, or alcohol where the `
      + "property serves it."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (kind === "alcohol" && !(await servesAlcohol(client, hotelId))) {
      return refuse(NOT_SERVING_ALCOHOL);
    }

    const { rows } = await client.query<{ name: string }>(
      `update pos_menu_categories set tax_kind = $3, updated_at = now()
        where id = $1 and hotel_id = $2
        returning name`,
      [c.req.param("id"), hotelId, kind],
    );
    if (!rows[0]) return refuse("No such category.");
    return { ok: true as const, name: rows[0].name, kind };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.post("/:code/till/menu/items/:id/prep", async (c) => {
  const input = await c.req.json<{ minutes?: unknown }>()
    .catch(() => ({} as { minutes?: unknown }));
  const minutes = minutesOrNull(input.minutes);
  if (minutes === "bad") {
    return c.json(refuse(
      "How many minutes? Send a whole number, or null to clear it and "
      + "fall back to the category.",
    ), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ name: string }>(
      `update pos_menu_items set prep_minutes = $3, updated_at = now()
        where id = $1 and hotel_id = $2
        returning name`,
      [c.req.param("id"), hotelId, minutes],
    );
    if (!rows[0]) return { ok: false as const, reason: "No such dish." };

    /* ⚠ A SECOND STATEMENT, AND IT HAS TO BE.
       `returning app.prep_minutes(id)` looks tidier and is wrong: the
       function runs its own SELECT against the table, which inside the
       same UPDATE still sees the PRE-UPDATE row. Clearing a dish's time
       reported the old number straight back, so the screen showed
       "3 min" the instant after somebody cleared it.

       Not solved by rebuilding the fallback in a CTE either — that
       would be a second copy of the rule, which is the thing
       `app.prep_minutes` exists to prevent. Same transaction, so this
       reads exactly what was just written. */
    const { rows: now } = await client.query<{ effective: number | null }>(
      "select app.prep_minutes($1) as effective", [c.req.param("id")],
    );

    return {
      ok: true as const,
      name: rows[0].name,
      /* What the kitchen will now see, which after a clear may be the
         category's number rather than nothing. */
      prepMinutes: now[0]?.effective ?? null,
      ownPrepMinutes: minutes,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.post("/:code/till/menu/categories/:id/prep", async (c) => {
  const input = await c.req.json<{ minutes?: unknown }>()
    .catch(() => ({} as { minutes?: unknown }));
  const minutes = minutesOrNull(input.minutes);
  if (minutes === "bad") {
    return c.json(refuse(
      "How many minutes? Send a whole number, or null to clear the "
      + "default for this category.",
    ), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ name: string }>(
      `update pos_menu_categories set prep_minutes = $3, updated_at = now()
        where id = $1 and hotel_id = $2
        returning name`,
      [c.req.param("id"), hotelId, minutes],
    );
    if (!rows[0]) return { ok: false as const, reason: "No such category." };

    /* HOW MANY DISHES THIS ACTUALLY MOVED. A default that changes
       nothing because every dish overrides it is worth saying out
       loud — otherwise somebody sets it, sees no effect anywhere, and
       concludes the feature is broken. */
    const { rows: moved } = await client.query<{ n: string }>(
      `select count(*)::text as n from pos_menu_items
        where category_id = $1 and hotel_id = $2 and prep_minutes is null`,
      [c.req.param("id"), hotelId],
    );

    return {
      ok: true as const,
      name: rows[0].name,
      prepMinutes: minutes,
      dishesAffected: Number(moved[0]!.n),
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.post("/:code/till/menu/items/:id/toggle", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Off, not gone. A dish that is unavailable today has a history of
       being sold, and the lines that sold it point at this row. */
    const { rows } = await client.query<{ is_active: boolean; name: string }>(
      `update pos_menu_items set is_active = not is_active
        where id = $1 and hotel_id = $2
        returning is_active, name`,
      [c.req.param("id"), hotelId],
    );
    if (!rows[0]) return { ok: false as const, reason: "No such item." };
    return { ok: true as const, isActive: rows[0].is_active, name: rows[0].name };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ══════════════════════════════════════════════════════════════════
   VARIATIONS AND ADD-ONS, AS THE KITCHEN MANAGER KEEPS THEM

   045 made the tables and the order pad has sold from them since; until
   21 September nothing but the demo loader could write one (D21-39). The
   owner's answers: an add-on group made once and offered on many dishes,
   saying how many a guest may choose (D21-41). Since 30 September a dish
   has one or more variation TYPES, saved together on one form (D27-189,
   D27-192): Size, Quantity, or an Option with the manager's heading;
   the first type carries the dish's price, each further one adds to it.

   REMOVED, NEVER DELETED. A line on a printed bill points at the
   variation or add-on it sold, so removing one switches it off
   (`is_active`) and the menu stops offering it. The same name typed
   again in the same type brings that row back.

   EVERY PRICE IS TYPED, OR TICKED FREE. A blank is refused, never kept
   as zero, and a 0 without the Free tick is refused too (D27-120, which
   replaced D21-42's "type 0").
   ══════════════════════════════════════════════════════════════════ */

type Named = { label?: unknown; price?: unknown; free?: unknown };
const labelOf = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");
const TYPE_KINDS = ["size", "quantity", "option"];

/** A price as the form sends it: typed, or ticked Free (0). Null with the
    reason when it is neither, or a 0 that was not ticked. */
function priceOf(raw: Named): { price: number } | { reason: string } {
  const free = raw.free === true;
  const price = free ? 0 : typedPrice(raw.price);
  if (price === null) return { reason: NO_PRICE };
  const bad = priceProblem(price, free);
  return bad ? { reason: bad } : { price };
}

/** THE WHOLE SET, in one transaction (D27-192, T2). A choice keeps its
    row by its type and name, so a name moved back into a type it left
    revives that row; one sent with an id and a new name renames it. */
till.put("/:code/till/menu/items/:id/variations", async (c) => {
  type TypeIn = { kind?: unknown; heading?: unknown; choices?: (Named & { id?: unknown })[] };
  type SetIn = { types?: TypeIn[]; dishPrice?: unknown; dishFree?: unknown };
  const input = await c.req.json<SetIn>().catch(() => ({}) as SetIn);
  const typesIn = Array.isArray(input.types) ? input.types : [];

  type Choice = { id: string | null; typeNo: number; label: string; price: number;
                  kind: string; heading: string | null; sort: number };
  const wanted: Choice[] = [];
  for (const [i, t] of typesIn.entries()) {
    const typeNo = i + 1;
    const kind = typeof t.kind === "string" ? t.kind : "";
    if (!TYPE_KINDS.includes(kind)) {
      return c.json(refuse(`Type ${typeNo}: pick Size, Quantity or Option.`), 409);
    }
    const heading = kind === "option" ? labelOf(t.heading) : null;
    if (heading === "") {
      return c.json(refuse(`Type ${typeNo}: an Option needs a heading - Spice level, Crust.`), 409);
    }
    const choices = Array.isArray(t.choices) ? t.choices : [];
    if (choices.length === 0) return c.json(refuse(`Type ${typeNo} has no choices.`), 409);
    const seen = new Set<string>();
    for (const [j, ch] of choices.entries()) {
      const label = labelOf(ch.label);
      if (!label) return c.json(refuse("A choice needs a name - Small, Half, Mild."), 409);
      if (seen.has(label.toLowerCase())) {
        return c.json(refuse(`${label} is in type ${typeNo} twice.`), 409);
      }
      seen.add(label.toLowerCase());
      const priced = priceOf(ch);
      if ("reason" in priced) return c.json(refuse(`${label}: ${priced.reason}`), 409);
      wanted.push({ id: typeof ch.id === "string" ? ch.id : null, typeNo, label,
                    price: priced.price, kind, heading, sort: j + 1 });
    }
  }
  const dishPrice = typesIn.length === 0
    ? priceOf({ price: input.dishPrice, free: input.dishFree }) : null;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const itemId = c.req.param("id");

    const { rows: dish } = await client.query<{ name: string }>(
      "select name from pos_menu_items where id = $1 and hotel_id = $2", [itemId, hotelId]);
    if (!dish[0]) return refuse("No such dish.");
    const { rows: rows } = await client.query<{
      id: string; type_no: number; label: string; is_active: boolean;
    }>(
      `select id::text, type_no, label, is_active from pos_item_variations
        where item_id = $1`, [itemId]);

    /* Removing the last one makes the dish one price again, and that
       price has not been looked at since it gained variations - so it is
       typed now (the owner, 21 September). */
    const hadAny = rows.some((r) => r.is_active);
    if (dishPrice && hadAny && "reason" in dishPrice) {
      return refuse(`${dish[0].name} will be sold at one price again. `
        + `What price? ${dishPrice.reason}`);
    }

    /* Which row each choice lands on: the same type and name first (a
       revival), then the row its id names if nobody took it, else new. */
    const byKey = new Map(rows.map((r) => [`${r.type_no}|${r.label}`, r.id]));
    const ids = new Set(rows.map((r) => r.id));
    const taken = new Set<string>();
    const rowOf = new Map<Choice, string | null>();
    for (const w of wanted) {
      const hit = byKey.get(`${w.typeNo}|${w.label}`);
      if (hit) { taken.add(hit); rowOf.set(w, hit); }
    }
    for (const w of wanted) {
      if (rowOf.has(w)) continue;
      const own = w.id && ids.has(w.id) && !taken.has(w.id) ? w.id : null;
      if (own) taken.add(own);
      rowOf.set(w, own);
    }

    await client.query(
      `update pos_item_variations set is_active = false
        where item_id = $1 and is_active and not (id = any($2::uuid[]))`,
      [itemId, [...taken]]);
    for (const w of wanted) {
      const row = rowOf.get(w);
      const values = [w.typeNo, w.label, w.price, w.kind, w.heading, w.sort];
      if (row) {
        await client.query(
          `update pos_item_variations
              set type_no = $2, label = $3, price = $4, kind = $5, heading = $6,
                  sort_order = $7, is_active = true
            where id = $1`, [row, ...values]);
      } else {
        await client.query(
          `insert into pos_item_variations
             (hotel_id, item_id, type_no, label, price, kind, heading, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`, [hotelId, itemId, ...values]);
      }
    }
    if (dishPrice && hadAny && "price" in dishPrice) {
      await client.query(
        "update pos_menu_items set price = $3, updated_at = now() where id = $1 and hotel_id = $2",
        [itemId, hotelId, dishPrice.price]);
    }
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Add-on groups ───────────────────────────────────────────────── */

till.get("/:code/till/menu/addon-groups", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: groups } = await client.query<{
      id: string; label: string; min_select: number;
      max_select: number | null; item_ids: string[];
    }>(
      `select g.id::text, g.label, g.min_select, g.max_select,
              array(select ig.item_id::text from pos_item_addon_groups ig
                     where ig.group_id = g.id) as item_ids
         from pos_addon_groups g
        where g.hotel_id = $1
        order by g.sort_order, g.label`,
      [hotelId]);

    const { rows: addons } = await client.query<{
      id: string; group_id: string; label: string; price: string;
      off_until: string | null;
    }>(
      `select id::text, group_id::text, label, price::text, off_until::text
         from pos_addons
        where hotel_id = $1 and is_active
        order by sort_order, label`,
      [hotelId]);

    return {
      groups: groups.map((g) => ({
        id: g.id, label: g.label, minSelect: g.min_select,
        maxSelect: g.max_select, itemIds: g.item_ids,
        addons: addons.filter((a) => a.group_id === g.id).map((a) => ({
          id: a.id, label: a.label, price: Number(a.price), offUntil: a.off_until,
        })),
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

type GroupBody = { label?: unknown; minSelect?: unknown; maxSelect?: unknown };

/** "How many a guest may choose" (D21-41): at least a whole number from
    0 (0 is optional), at most one from 1 or null for no limit. A sentence
    when it is not. */
function groupRule(input: GroupBody):
  { label: string; min: number; max: number | null } | string {
  const label = labelOf(input.label);
  if (!label) return "A group needs a name - Choice of bread, Preferences.";
  const min = input.minSelect;
  const max = input.maxSelect ?? null;
  if (!Number.isInteger(min) || (min as number) < 0 || (min as number) > 99) {
    return "Choose at least: a whole number. 0 means the guest may take none.";
  }
  if (max !== null && (!Number.isInteger(max) || (max as number) < 1
                       || (max as number) > 99)) {
    return "Choose at most: a whole number from 1, or empty for no limit.";
  }
  if (max !== null && (min as number) > (max as number)) {
    return "Choose at least cannot be more than choose at most.";
  }
  return { label, min: min as number, max: max as number | null };
}

till.post("/:code/till/menu/addon-groups", async (c) => {
  const rule = groupRule(await c.req.json<GroupBody>().catch(() => ({})));
  if (typeof rule === "string") return c.json(refuse(rule), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ id: string }>(
      `insert into pos_addon_groups (hotel_id, label, min_select, max_select)
       values ($1,$2,$3,$4)
       on conflict (hotel_id, label) do nothing
       returning id::text`,
      [hotelId, rule.label, rule.min, rule.max]);
    if (!rows[0]) return refuse(`There is already a group called ${rule.label}.`);
    return { ok: true as const, id: rows[0].id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.patch("/:code/till/menu/addon-groups/:id", async (c) => {
  const rule = groupRule(await c.req.json<GroupBody>().catch(() => ({})));
  if (typeof rule === "string") return c.json(refuse(rule), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");

    const { rows: clash } = await client.query(
      `select 1 from pos_addon_groups
        where hotel_id = $1 and label = $2 and id <> $3`,
      [hotelId, rule.label, id]);
    if (clash[0]) return refuse(`There is already a group called ${rule.label}.`);

    const { rowCount } = await client.query(
      `update pos_addon_groups set label = $3, min_select = $4, max_select = $5
        where id = $1 and hotel_id = $2`,
      [id, hotelId, rule.label, rule.min, rule.max]);
    if (!rowCount) return refuse("No such add-on group.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/** Which dishes offer this group: the whole list, replacing the last. */
till.post("/:code/till/menu/addon-groups/:id/dishes", async (c) => {
  const input = await c.req.json<{ itemIds?: unknown }>()
    .catch(() => ({}) as { itemIds?: unknown });
  const itemIds = Array.isArray(input.itemIds)
    && input.itemIds.every((x) => typeof x === "string")
    ? [...new Set(input.itemIds as string[])] : null;
  if (!itemIds) return c.json(refuse("Which dishes?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");

    const { rows: group } = await client.query(
      "select 1 from pos_addon_groups where id = $1 and hotel_id = $2",
      [id, hotelId]);
    if (!group[0]) return refuse("No such add-on group.");

    /* Every dish this hotel's, before anything is written: the join
       table carries no hotel of its own (045). */
    const { rows: mine } = await client.query<{ n: string }>(
      `select count(*)::text as n from pos_menu_items
        where id = any($1::uuid[]) and hotel_id = $2`,
      [itemIds, hotelId]);
    if (Number(mine[0]!.n) !== itemIds.length) return refuse("No such dish.");

    await client.query(
      `delete from pos_item_addon_groups
        where group_id = $1 and not (item_id = any($2::uuid[]))`,
      [id, itemIds]);
    await client.query(
      `insert into pos_item_addon_groups (item_id, group_id)
       select unnest($2::uuid[]), $1 on conflict do nothing`,
      [id, itemIds]);
    return { ok: true as const, dishes: itemIds.length };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The options in a group ──────────────────────────────────────── */

till.post("/:code/till/menu/addon-groups/:id/addons", async (c) => {
  const input = await c.req.json<Named>().catch(() => ({}) as Named);
  const label = labelOf(input.label);
  if (!label) return c.json(refuse("An option needs a name - Butter naan, No onion."), 409);
  const priced = priceOf(input);
  if ("reason" in priced) return c.json(refuse(priced.reason), 409);
  const price = priced.price;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");

    const { rows: group } = await client.query<{ label: string }>(
      "select label from pos_addon_groups where id = $1 and hotel_id = $2",
      [groupId, hotelId]);
    if (!group[0]) return refuse("No such add-on group.");

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_addons (hotel_id, group_id, label, price, sort_order)
       values ($1, $2, $3, $4,
               (select coalesce(max(sort_order), 0) + 1
                  from pos_addons where group_id = $2))
       on conflict (group_id, label) do update
         set price = excluded.price, is_active = true
         where not pos_addons.is_active
       returning id::text`,
      [hotelId, groupId, label, price]);
    if (!rows[0]) return refuse(`${group[0].label} already has ${label}.`);
    return { ok: true as const, id: rows[0].id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/** Rename and reprice, both sent. A price changed here changes on every
    dish that offers the group - it is one row (D21-41). */
till.patch("/:code/till/menu/addons/:id", async (c) => {
  const input = await c.req.json<Named>().catch(() => ({}) as Named);
  const label = labelOf(input.label);
  if (!label) return c.json(refuse("An option needs a name."), 409);
  const priced = priceOf(input);
  if ("reason" in priced) return c.json(refuse(priced.reason), 409);
  const price = priced.price;

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");

    const { rows: clash } = await client.query<{ is_active: boolean; grp: string }>(
      `select o.is_active, g.label as grp
         from pos_addons a
         join pos_addons o on o.group_id = a.group_id
                          and o.label = $3 and o.id <> a.id
         join pos_addon_groups g on g.id = a.group_id
        where a.id = $1 and a.hotel_id = $2`,
      [id, hotelId, label]);
    if (clash[0]) {
      return refuse(clash[0].is_active
        ? `${clash[0].grp} already has ${label}.`
        : `${clash[0].grp} had a ${label} that was removed. Add ${label} again `
          + "to bring it back.");
    }

    const { rowCount } = await client.query(
      `update pos_addons set label = $3, price = $4
        where id = $1 and hotel_id = $2 and is_active`,
      [id, hotelId, label, price]);
    if (!rowCount) return refuse("No such option.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.post("/:code/till/menu/addons/:id/remove", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update pos_addons set is_active = false
        where id = $1 and hotel_id = $2 and is_active`,
      [c.req.param("id"), hotelId]);
    if (!rowCount) return refuse("No such option.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The add-ons file (the owner's D21-43, 21 September) ─────────────
   Its own file, imported BEFORE the menu file that names its groups:
   one row per option - Group, Option, Price, and the group's rule on any
   of its rows. Same two passes and the same refusals as the menu: a
   blank price is refused, never zero; re-importing updates and never
   removes. */

interface AddonRow {
  group?: string; option?: string; price?: string | number;
  minSelect?: string | number; maxSelect?: string | number;
}

till.post("/:code/till/menu/addon-groups/import", async (c) => {
  const input = await c.req.json<{ rows?: AddonRow[]; dryRun?: boolean }>()
    .catch(() => ({}) as { rows?: AddonRow[]; dryRun?: boolean });
  const rows = input.rows ?? [];
  const dryRun = input.dryRun !== false;
  if (rows.length === 0) return c.json(refuse("There are no rows in that file."), 409);
  if (rows.length > 2000) {
    return c.json(refuse(`That file has ${rows.length} rows. Two thousand is the limit.`), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: existing } = await client.query<{
      label: string; min_select: number; max_select: number | null;
      options: string[];
    }>(
      `select g.label, g.min_select, g.max_select,
              array(select a.label from pos_addons a
                     where a.group_id = g.id and a.is_active) as options
         from pos_addon_groups g where g.hotel_id = $1`,
      [hotelId]);
    const onMenu = new Map(existing.map((g) => [g.label.toLowerCase(), g]));

    const verdicts: Verdict[] = [];
    const seen = new Set<string>();
    /* group, as spelled on the menu or first in the file → its rule and options */
    const good = new Map<string, {
      label: string; min?: number; max?: number | null;
      options: { label: string; price: number }[];
    }>();

    const whole = (raw: unknown) => {
      const t = String(raw ?? "").trim();
      return t === "" ? undefined : /^\d+$/.test(t) ? Number(t) : NaN;
    };

    rows.forEach((raw, i) => {
      const line = i + 2;
      const groupName = String(raw.group ?? "").trim();
      const option = String(raw.option ?? "").trim();
      const reject = (detail: string) => verdicts.push({
        line, name: option || groupName || "(no name)", action: "rejected", detail,
      });

      if (!groupName && !option) return;
      if (!groupName) return reject("No group - which list is this option in?");
      if (!option) return reject("No option name.");

      const rawPrice = String(raw.price ?? "").trim();
      if (rawPrice === "") {
        return reject("No price. A blank is not zero - type 0 for a preference "
          + "such as No onion.");
      }
      const price = typedPrice(rawPrice);
      if (price === null) return reject(`"${rawPrice}" is not a price.`);
      /* D27-192 (Q6, D): a file cannot tick Free, as the menu file cannot. */
      if (price === 0) {
        return reject("0 is not taken from a file. Add a free option on the menu screen, ticked Free.");
      }

      const min = whole(raw.minSelect);
      const max = whole(raw.maxSelect);
      if (Number.isNaN(min)) return reject(`"${raw.minSelect}" is not a whole number.`);
      if (Number.isNaN(max) || max === 0) {
        return reject(`"${raw.maxSelect}" is not a whole number from 1.`);
      }

      const gk = groupName.toLowerCase();
      const before = onMenu.get(gk);
      const group = good.get(gk) ?? {
        label: before?.label ?? groupName, options: [],
      };
      /* The group's rule, as it would stand after this row: what the menu
         has, then what earlier rows said, then this row. A row that
         disagrees with an earlier one is named, not quietly outvoted. */
      if (min !== undefined && group.min !== undefined && group.min !== min) {
        return reject(`Choose at least is ${group.min} on an earlier row of `
          + `${group.label}.`);
      }
      if (max !== undefined && group.max !== undefined && group.max !== max) {
        return reject(`Choose at most is ${group.max} on an earlier row of `
          + `${group.label}.`);
      }
      const effMin = min ?? group.min ?? before?.min_select ?? 0;
      const effMax = max ?? (group.max === undefined
        ? before?.max_select ?? null : group.max);
      if (effMax !== null && effMin > effMax) {
        return reject(`${group.label}: choose at least ${effMin} is more than `
          + `choose at most ${effMax}.`);
      }

      const ok = `${gk}|${option.toLowerCase()}`;
      if (seen.has(ok)) return reject(`"${option}" appears twice in ${group.label}.`);
      seen.add(ok);

      const spelled = before?.options.find((o) => o.toLowerCase() === option.toLowerCase());
      if (min !== undefined) group.min = min;
      if (max !== undefined) group.max = max;
      group.options.push({ label: spelled ?? option, price });
      good.set(gk, group);

      verdicts.push({
        line,
        name: `${group.label}: ${spelled ?? option}`,
        action: spelled ? "update" : "create",
        detail: spelled ? `price becomes ${price}` : `${price}`,
      });
    });

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: verdicts.filter((v) => v.action === "update").length,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };
    if (dryRun) return { ok: true as const, dryRun: true, verdicts, ...tally };

    for (const g of good.values()) {
      /* Unsaid on a new group means optional and no limit - the
         database's own reading of an empty rule (045). Unsaid on one
         already on the menu keeps what it has. */
      const { rows: made } = await client.query<{ id: string }>(
        `insert into pos_addon_groups (hotel_id, label, min_select, max_select)
         values ($1, $2, coalesce($3::smallint, 0), $4::smallint)
         on conflict (hotel_id, label) do update
           set min_select = coalesce($3::smallint, pos_addon_groups.min_select),
               max_select = case when $5::boolean then $4::smallint
                                 else pos_addon_groups.max_select end
         returning id::text`,
        [hotelId, g.label, g.min ?? null, g.max ?? null, g.max !== undefined]);
      for (const [i, o] of g.options.entries()) {
        await client.query(
          `insert into pos_addons (hotel_id, group_id, label, price, sort_order)
           values ($1,$2,$3,$4,$5)
           on conflict (group_id, label) do update
             set price = excluded.price, is_active = true`,
          [hotelId, made[0]!.id, o.label, o.price, i + 1]);
      }
    }
    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Rooms a bill can be charged to ───────────────────────────────── */

/* WHOSE BILL, when a stay's is split (D27-162): a company's bill names the
   company, so the till can ask "Tanvi Bhide" or "Tanvi Bhide - bill to
   ACME" rather than one name twice. A name the reader may not see is
   "the company". */
const BILL_JOIN = `join folios f on f.id = c.folio_id
  left join companies co on co.id = f.company_id`;
const BILL_COMPANY = `case when f.bill_to = 'company'
  then coalesce(co.name, 'the company') end as company`;

till.get("/:code/till/rooms", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The same function the bridge uses. A room is chargeable when
       somebody is checked into it AND their folio is open — not merely
       when the room is occupied. Two different questions with two
       different answers on a checkout morning. */
    const { rows } = await client.query<{
      room_number: string; guest_name: string; folio_id: string; company: string | null;
    }>(
      `select c.room_number, c.guest_name, c.folio_id::text, ${BILL_COMPANY}
         from app.pos_chargeable_rooms($1) c ${BILL_JOIN}
        order by c.room_number collate app.room_order`,
      [hotelId],
    );

    return {
      rooms: rows.map((r) => ({
        room: r.room_number, guest: r.guest_name, folioId: r.folio_id, company: r.company,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Orders ───────────────────────────────────────────────────────── */

/** One order with its lines and what it comes to. */
export async function readOrder(client: Client, orderId: string) {
  const { rows: head } = await client.query<{
    id: string; order_no: string; outlet: string; outlet_name: string;
    hotel_name: string; hotel_city: string | null; hotel_gstin: string | null;
    hotel_fssai: string | null;
    sac_codes: string | null;
    table_ref: string | null; status: string; business_date: string;
    payment_method: string | null; opened_by_name: string | null;
    discount_type: string | null; discount_value: string | null;
    discount_reason: string | null;
    promotion_id: string | null; promotion_name: string | null;
    covers: number | null; waiter_name: string | null; order_type: string;
    customer_name: string | null; customer_phone: string | null;
    customer_address: string | null; customer_locality: string | null;
    held_at: string | null;
    settled_by_name: string | null; settled_at: string | null;
    abandoned_reason: string | null; ticket_id: string | null;
    event_id: string | null; event_title: string | null;
    vat_bill: string | null;
    bills_printed: number;
    room: string | null;
    voided_by_name: string | null; voided_at: string | null;
    void_reason: string | null; void_reference: string | null;
    nc_by_name: string | null; nc_at: string | null; nc_reason: string | null;
  }>(
    /* The hotel's details travel WITH the order, the way the invoice
       carries its own. A bill printed today should still read the same
       next year, and a browser assembling it from a live property list
       would quietly reprint it with June's address. */
    `select o.id::text, o.order_no, ou.code as outlet, ou.name as outlet_name,
            h.name as hotel_name, h.city as hotel_city, h.gstin as hotel_gstin,
            h.fssai_number as hotel_fssai,
            /* D27-344: the HSN/SAC of each kind the bill's lines sell under
               (Settings > Taxes), as the invoice's lines carry theirs. */
            (select string_agg(distinct ts.sac_code, ', ' order by ts.sac_code)
               from pos_order_lines l
               join pos_menu_items i on i.id = l.item_id
               join pos_menu_categories c on c.id = i.category_id
               join tax_sac ts on ts.hotel_id = l.hotel_id and ts.kind = c.tax_kind
              where l.order_id = o.id and not l.voided) as sac_codes,
            o.table_ref, o.status,
            to_char(o.business_date,'YYYY-MM-DD') as business_date,
            o.payment_method,
            o.discount_type, o.discount_value::text, o.discount_reason,
            o.promotion_id::text, pr.name as promotion_name,
            o.covers, s3.full_name as waiter_name, o.order_type,
            o.customer_name, o.customer_phone, o.customer_address,
            o.customer_locality, o.held_at::text,
            s1.full_name as opened_by_name,
            s2.full_name as settled_by_name,
            app.hotel_clock(o.hotel_id, o.settled_at, 'DD Mon, HH24:MI') as settled_at,
            o.abandoned_reason, o.ticket_id::text,
            o.event_id::text, e.title as event_title,
            (select v.number from vat_bills v where v.pos_order_id = o.id) as vat_bill,
            (select count(*)::int from pos_bill_prints b
              where b.order_id = o.id and b.heading in ('bill', 'duplicate')) as bills_printed,
            /* The room a bill charged to a room went to (D27-324: a void
               names it), through the ticket that carried it. */
            (select app.stay_room(f.reservation_id) from pos_tickets t
               join folios f on f.id = t.folio_id where t.id = o.ticket_id) as room,
            s4.full_name as voided_by_name,
            to_char(o.voided_at at time zone h.timezone, 'HH24:MI') as voided_at,
            o.void_reason, o.void_reference,
            s5.full_name as nc_by_name,
            to_char(o.nc_at at time zone h.timezone, 'HH24:MI') as nc_at,
            o.nc_reason
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       join hotels h on h.id = o.hotel_id
       left join pos_promotions pr on pr.id = o.promotion_id
       /* LEFT joins, all three staff reads (D27-1, MEMORY 283): staff is
          row-secured, so an inner join hid an order the group owner opened
          from the GM - "No such order". A name the reader may not see is
          null, and the screen prints a dash. */
       left join staff s1 on s1.id = o.opened_by
       left join staff s2 on s2.id = o.settled_by
       left join staff s3 on s3.id = o.waiter_id
       left join staff s4 on s4.id = o.voided_by
       left join staff s5 on s5.id = o.nc_by
       left join banquet_events e on e.id = o.event_id
      where o.id = $1`,
    [orderId],
  );
  if (!head[0]) return null;

  const { rows: lines } = await client.query<{
    id: string; name: string; qty: string; unit_price: string;
    tax_rate: string; tax_scheme: "gst" | "vat"; note: string | null; voided: boolean;
    kot_status: string;
    added_by_name: string | null;
    parent_line_id: string | null;
    variation_id: string | null; addon_id: string | null;
    item_id: string | null; extra_choice_ids: string[] | null;
    numbered_addons: LineAddons | null;
    extra_kind: "custom" | "numbered" | null;
    kot_no: number | null; kot_kind_id: string | null; kot_kind_name: string | null;
    packing: boolean;
  }>(
    `select l.id::text, l.name, l.qty::text, l.unit_price::text,
            l.tax_rate::text, l.tax_scheme, l.note, l.voided, l.kot_status,
            s.full_name as added_by_name,
            l.parent_line_id::text, l.variation_id::text, l.addon_id::text,
            l.item_id::text, l.extra_choice_ids::text[] as extra_choice_ids,
            l.numbered_addons, l.extra_kind,
            l.kot_no, k.id::text as kot_kind_id, k.name as kot_kind_name, l.packing
       from pos_order_lines l
       left join staff s on s.id = l.added_by
       /* A sent line's kind; one sent before kinds were stamped (211) by its
          dish, as the station reads it - so its KOT reprints per kind. */
       left join pos_kot_kinds k on k.id = case when l.kot_no is not null and not l.packing
                                           then coalesce(l.kot_kind_id, app.pos_line_kot_kind(l.id)) end
      where l.order_id = $1
      /* Each dish, then what hangs under it: an add-on put on a dish after
         three more dishes (D27-291) still reads under ITS dish. */
      order by coalesce(l.parent_line_id, l.id), l.parent_line_id nulls first, l.id`,
    [orderId],
  );

  /* The total comes from the DATABASE, not from adding the lines up
     here. One definition, used by the till, the bill and the
     settlement, so the three cannot disagree about what a guest owes. */
  const { rows: total } = await client.query<{
    net: string; discount: string; taxable: string; tax: string;
    gross: string; round_off: string; payable: string;
  }>(`select net::text, discount::text, taxable::text, tax::text,
             gross::text, round_off::text, payable::text
        from app.pos_order_total($1)`,
    [orderId]);

  /* The bill's tax lines (D27-334): the database's split by scheme and rate,
     on the DISCOUNTED value, so the paper adds up to what the guest pays. */
  const { rows: taxes } = await client.query<{ tax_scheme: "gst" | "vat"; tax_rate: string; tax: string }>(
    `select t.tax_scheme, t.tax_rate::text, t.tax::text
       from app.pos_order_by_tax($1) t
      where t.tax <> 0
      order by t.tax_scheme, t.tax_rate`,
    [orderId]);

  /* What was actually taken, and how. One row for an ordinary bill,
     several when the guest paid part cash and part card. Empty while the
     order is open — nothing has been taken yet. */
  const { rows: tenders } = await client.query<{
    id: string; method: string; amount: string;
    tendered: string | null; reference: string | null; taken_by_name: string | null;
  }>(
    `select t.id::text, t.method, t.amount::text, t.tendered::text,
            t.reference, s.full_name as taken_by_name
       from pos_order_tenders t
       left join staff s on s.id = t.taken_by
      where t.order_id = $1
      order by t.id`,
    [orderId],
  );

  const h = head[0];
  return {
    id: h.id,
    orderNo: h.order_no,
    outlet: h.outlet,
    outletName: h.outlet_name,
    hotelName: h.hotel_name,
    hotelCity: h.hotel_city,
    hotelGstin: h.hotel_gstin,
    /* A16: printed on every restaurant bill; null prints a dash. */
    hotelFssai: h.hotel_fssai,
    /* D27-344: its HSN/SAC codes; null prints a dash. */
    hotelSac: h.sac_codes,
    table: h.table_ref,
    status: h.status,
    businessDate: h.business_date,
    paymentMethod: h.payment_method,
    openedBy: h.opened_by_name,
    settledBy: h.settled_by_name,
    settledAt: h.settled_at,
    abandonedReason: h.abandoned_reason,
    ticketId: h.ticket_id,
    /* The banquet function this order is on (D17-21), and its name for
       the screen. An order on a function is paid on the function's bill
       and settles to it alone. */
    eventId: h.event_id,
    eventTitle: h.event_title,
    /* D22-44: the VAT bill issued for this bill's alcohol when it was paid. */
    vatBill: h.vat_bill,
    /* Bills printed after payment (D27-292): the next is BILL · DUPLICATE. */
    billsPrinted: h.bills_printed,
    room: h.room,
    /* A paid bill voided (D27-324): who, when (HH:MM), why, and the
       refund's reference for card or UPI. Null on any other bill. */
    voidedBy: h.voided_by_name,
    voidedAt: h.voided_at,
    voidReason: h.void_reason,
    voidReference: h.void_reference,
    /* A bill given free, NC (D27-351): who gave it (their name is the
       approval), when (HH:MM) and why. Null on any other bill. */
    ncBy: h.nc_by_name,
    ncAt: h.nc_at,
    ncReason: h.nc_reason,
    /* What was sent to the GM about it, and the answer (D27-363). */
    requests: (await client.query<{ id: string; kind: string; line_id: string | null; summary: string; status: string;
      decision_note: string | null; by: string | null }>(
      `select r.id::text, r.kind, r.line_id::text, r.summary, r.status, r.decision_note, s.full_name as by
         from pos_requests r left join staff s on s.id = r.decided_by
        where r.order_id = $1 order by r.requested_at desc limit 10`, [orderId])).rows
      .map((q) => ({ id: q.id, kind: q.kind, lineId: q.line_id, summary: q.summary, status: q.status,
        note: q.decision_note, decidedBy: q.by })),
    /* Its payment mode changed before the night audit (D27-363). */
    modeChanges: (await client.query<{ from_method: string; to_method: string; amount: string; reason: string;
      by: string | null; at: string }>(
      `select c.from_method, c.to_method, c.amount::text, c.reason, s.full_name as by,
              app.hotel_clock(c.hotel_id, c.changed_at, 'HH24:MI') as at
         from pos_tender_changes c left join staff s on s.id = c.changed_by
        where c.order_id = $1 order by c.changed_at`, [orderId])).rows
      .map((m) => ({ from: m.from_method, to: m.to_method, amount: Number(m.amount), reason: m.reason, by: m.by, at: m.at })),
    /* Its table moves and joins (D27-370): who, when, from which table to which. */
    moves: (await client.query<{ from_table: string; to_table: string; joined: boolean; by: string | null; at: string }>(
      `select m.from_table, m.to_table, m.joined_order_id is not null as joined, s.full_name as by,
              app.hotel_clock(m.hotel_id, m.moved_at, 'HH24:MI') as at
         from pos_table_moves m left join staff s on s.id = m.moved_by
        where m.order_id = $1 order by m.moved_at`, [orderId])).rows
      .map((m) => ({ from: m.from_table, to: m.to_table, joined: m.joined, by: m.by, at: m.at })),

    /* The header. `covers` is people eating, not seats — average per
       cover is the metric a restaurant runs on, and a table for two
       that seats six says nothing. */
    covers: h.covers,
    waiter: h.waiter_name,
    orderType: h.order_type,
    customerName: h.customer_name,
    customerPhone: h.customer_phone,
    customerAddress: h.customer_address,
    customerLocality: h.customer_locality,
    heldAt: h.held_at,
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      qty: Number(l.qty),
      unitPrice: Number(l.unit_price),
      taxRate: Number(l.tax_rate),
      /* "vat" for alcohol (D21-91): the bill prints it as one VAT line,
         never as a CGST and SGST pair. */
      taxScheme: l.tax_scheme,
      note: l.note,
      voided: l.voided,
      /* pending until a waiter sends it. The till shows which dishes the
         kitchen has, so a second KOT does not re-fire the starters. */
      kotStatus: l.kot_status,
      /* The KOT it went on and that slip's kind, stamped when sent (211):
         the order screen reprints them (the owner's D27-324 (4)). */
      kotNo: l.kot_no,
      kotKind: l.kot_kind_id ? { id: l.kot_kind_id, name: l.kot_kind_name! } : null,
      /* A parcel's packing charge (D27-359): a bill line, no dish. */
      packing: l.packing,
      addedBy: l.added_by_name,
      /* An add-on names the dish it belongs to. The bill and the kitchen
         docket both indent on this: "Sides: Onions" under "Bhaaji Pau
         (Butter)", exactly as the printed ticket does. */
      parentLineId: l.parent_line_id,
      isAddon: l.addon_id !== null,
      /* The dish and its choices, so the waiter's pad can put one more of a
         sent dish on its next round (the owner's D27-349). */
      itemId: l.item_id,
      addonId: l.addon_id,
      moreChoiceIds: l.extra_choice_ids ?? [],
      variationId: l.variation_id,
      /* The numbered add-ons folded into this dish (D27-289), as chosen:
         the bill prints "Veg Biryani 310 · Kebab +120" under the line, and
         Customise opens on them. Null when it has none. */
      numberedAddons: l.numbered_addons,
      /* An add-on as a line of its own under parentLineId (D27-291): custom
         (typed) or numbered (on a dish already sent). Null on a dish or a
         side. Its own quantity; the bill reads "+ Extra papad". */
      extra: l.extra_kind,
    })),
    net: Number(total[0]!.net),
    /* The discount as APPLIED, which is what the arithmetic used. type and
       value are what the biller entered, and are what the bill prints —
       "10% off" rather than a number whose origin nobody can reconstruct. */
    discount: Number(total[0]!.discount),
    discountType: h.discount_type,
    discountValue: h.discount_value === null ? null : Number(h.discount_value),
    discountReason: h.discount_reason,
    /* WHICH promotion, not only that one was used. NULL means a biller
       applied a free-hand discount within the cap — a different act, and
       one the month-end report has to be able to tell apart. */
    promotionId: h.promotion_id,
    promotionName: h.promotion_name,
    taxable: Number(total[0]!.taxable),
    tax: Number(total[0]!.tax),
    taxes: taxes.map((t) => ({ scheme: t.tax_scheme, rate: Number(t.tax_rate), tax: Number(t.tax) })),
    gross: Number(total[0]!.gross),
    roundOff: Number(total[0]!.round_off),
    payable: Number(total[0]!.payable),
    tenders: tenders.map((t) => ({
      id: t.id,
      method: t.method,
      amount: Number(t.amount),
      tendered: t.tendered === null ? null : Number(t.tendered),
      /* Change is derived, never stored. A stored figure is one more thing
         that can disagree with the arithmetic. */
      change: t.tendered === null ? null : Number(t.tendered) - Number(t.amount),
      reference: t.reference,
      takenBy: t.taken_by_name,
    })),
  };
}

till.get("/:code/till/orders", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);

    /* Open orders regardless of date, plus everything settled today.

       Open ones ignore the date deliberately: an order left open when
       the night audit ran is a mistake somebody has to find, and
       filtering it out by date is how it stays lost. */
    const { rows } = await client.query<{
      id: string; order_no: string; outlet: string; table_ref: string | null;
      status: string; business_date: string; gross: string;
      payment_method: string | null; opened_at: string; lines: string;
    }>(
      `select o.id::text, o.order_no, ou.code as outlet, o.table_ref,
              o.status, to_char(o.business_date,'YYYY-MM-DD') as business_date,
              (select gross from app.pos_order_total(o.id))::text as gross,
              o.payment_method,
              app.hotel_clock(o.hotel_id, o.opened_at, 'HH24:MI') as opened_at,
              (select count(*) from pos_order_lines l
                where l.order_id = o.id and not l.voided)::text as lines
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
        where o.hotel_id = $1
          and (o.status = 'open' or o.business_date = $2::date)
        order by o.status = 'open' desc, o.opened_at desc
        limit 200`,
      [hotelId, businessDate],
    );

    return {
      businessDate,
      orders: rows.map((r) => ({
        id: r.id,
        orderNo: r.order_no,
        outlet: r.outlet,
        table: r.table_ref,
        status: r.status,
        businessDate: r.business_date,
        gross: Number(r.gross),
        paymentMethod: r.payment_method,
        openedAt: r.opened_at,
        lines: Number(r.lines),
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* AN EARLIER DAY'S BILL (the team's feedback of 18 October, item 7a; the
   owner, 20 October): the finished bills of one business date, or those
   whose number holds what was typed, on any day. Opened on the Till, its
   Print the bill prints BILL · DUPLICATE (D27-292); who may print is as for
   today's bills. Only paid, voided and NC bills (D27-351): an open order is
   on the Till already, and a bill closed unpaid has nothing to print.

   BILL HISTORY (the owner's D27-370, 27 October): the same question over a
   RANGE of dates - `from` and `to`, either may be left off - narrowed by the
   bill's number, table, guest (name or phone), payment mode, waiter and
   outlet, every part optional and every one a bound parameter. `date` is
   from = to = that day, so the Till asks as it always did. At most
   BILLS_CAP rows answer; `capped` says so, and the screen says it.

   FOR MANAGERS AND THE CASHIER ONLY (the owner's D27-372, 28 October): a
   range of dates or any of those filters is BILL_HISTORY_ROLES' (and a group
   administrator's); everyone else this route answers - the waiter, the bar, a
   Viewer - keeps the Till's own question, one day (`date`) or a number (`no`).
   A bill charged to a room shows, and is found by, the stay's guest and room. */
const BILLS_CAP = 500;
export const BILL_HISTORY_ROLES: readonly string[] = ["owner", "admin", "gm", "hotel_manager", "finance", "front_desk"];
const BILL_MODES = ["cash", "card", "upi", "room", "function", "allowance", "split"];
const isoDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
/** A typed fragment for `ilike`, its own % and _ taken literally. */
const likePart = (v: string) => v.replace(/[\\%_]/g, (m) => "\\" + m);

till.get("/:code/till/bills", async (c) => {
  const q = (k: string) => (c.req.query(k) ?? "").trim();
  const day = q("date");
  const from = day || q("from");
  const to = day || q("to");
  const no = q("no");
  const table = q("table");
  const guest = q("guest");
  const mode = q("mode").toLowerCase();
  const waiter = q("waiter");
  const outlet = q("outlet").toUpperCase();
  /* `limit` may only ask for FEWER than the cap (a test, a small look). */
  const cap = Math.min(BILLS_CAP, Math.max(1, Math.floor(Number(q("limit"))) || BILLS_CAP));
  if (!from && !to && !no && !table && !guest) {
    return c.json(refuse("Pick a day, or type the bill's number."), 409);
  }
  for (const d of [from, to]) {
    if (d && !isoDay(d)) return c.json(refuse("Dates are written 2026-10-27."), 409);
  }
  if (from && to && from > to) return c.json(refuse("The first date is after the last."), 409);
  if (no.length > 40 || table.length > 40 || guest.length > 60) {
    return c.json(refuse("That is too long to search for."), 409);
  }
  if (mode && !BILL_MODES.includes(mode)) return c.json(refuse("Not a way of paying."), 409);
  if (waiter && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(waiter)) {
    return c.json(refuse("Not a waiter."), 409);
  }
  /* A phone is found however it was typed: 98765 43210 finds 9876543210. */
  const digits = /^[\d\s+()-]+$/.test(guest) ? guest.replace(/\D/g, "") : "";
  const wide = Boolean((!day && (q("from") || q("to"))) || table || guest || mode || waiter || outlet);
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (wide) {
      const { rows: [may] } = await client.query<{ ok: boolean }>(
        `select app.is_group_admin() or exists (
                  select 1 from staff_hotels sh
                   where sh.staff_id = app.current_user_id() and sh.hotel_id = $1
                     and sh.role = any($2::text[])) as ok`,
        [hotelId, BILL_HISTORY_ROLES]);
      if (!may!.ok) {
        return { forbidden: "Bill history is for the managers, the Accountant and Reception. "
          + "On the Till, look up one day's bills or a bill's number." };
      }
    }
    const { rows } = await client.query<{
      id: string; order_no: string; outlet: string; table_ref: string | null;
      status: string; business_date: string; gross: string; payable: string;
      payment_method: string | null; modes: string[]; opened_at: string; lines: string;
      waiter: string | null; customer_name: string | null; customer_phone: string | null;
      settled_at: string | null; stay_guest: string | null; stay_room: string | null;
    }>(
      `select o.id::text, o.order_no, ou.code as outlet, o.table_ref,
              o.status, to_char(o.business_date,'YYYY-MM-DD') as business_date,
              (select gross from app.pos_order_total(o.id))::text as gross,
              (select payable from app.pos_order_total(o.id))::text as payable,
              o.payment_method,
              array(select distinct t.method from pos_order_tenders t
                     where t.order_id = o.id order by t.method)::text[] as modes,
              app.hotel_clock(o.hotel_id, o.opened_at, 'HH24:MI') as opened_at,
              (select count(*) from pos_order_lines l
                where l.order_id = o.id and not l.voided)::text as lines,
              coalesce(sw.full_name, so.full_name) as waiter,
              o.customer_name, o.customer_phone,
              /* When it was paid - or given NC (D27-372). */
              app.hotel_clock(o.hotel_id, coalesce(o.settled_at, o.nc_at), 'HH24:MI') as settled_at,
              st.guest as stay_guest, st.room as stay_room
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
         /* LEFT joins: a name staff's row security hides prints as a dash. */
         left join staff sw on sw.id = o.waiter_id
         left join staff so on so.id = o.opened_by
         /* A bill charged to a room: the stay's guest and room (D27-372),
            through the ticket that carried it, as a void names the room. */
         left join lateral (
           select g.full_name as guest, app.stay_room(f.reservation_id) as room
             from pos_tickets t
             join folios f on f.id = t.folio_id
             left join reservations r on r.id = f.reservation_id
             left join guests g on g.id = r.guest_id
            where t.id = o.ticket_id and o.payment_method = 'room') st on true
        where o.hotel_id = $1 and o.status in ('settled', 'void', 'no_charge')
          and ($2::date is null or o.business_date >= $2::date)
          and ($3::date is null or o.business_date <= $3::date)
          and ($4 = '' or o.order_no ilike '%' || $4 || '%' escape '\\')
          and ($5 = '' or o.table_ref ilike '%' || $5 || '%' escape '\\')
          and ($6 = '' or o.customer_name ilike '%' || $6 || '%' escape '\\'
               or o.customer_phone ilike '%' || $6 || '%' escape '\\'
               or st.guest ilike '%' || $6 || '%' escape '\\'
               or upper(st.room) = upper($6)
               or ($7 <> '' and regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g') like '%' || $7 || '%'))
          and ($8 = '' or o.payment_method = $8
               or exists (select 1 from pos_order_tenders t where t.order_id = o.id and t.method = $8))
          and ($9::uuid is null or coalesce(o.waiter_id, o.opened_by) = $9::uuid)
          and ($10 = '' or ou.code = $10)
        order by o.business_date desc, o.opened_at desc
        limit $11`,
      [hotelId, from || null, to || null, likePart(no), likePart(table), likePart(guest), digits,
       mode, waiter || null, outlet, cap + 1],
    );
    const { rows: outlets } = await client.query<{ code: string; name: string }>(
      "select code, name from pos_outlets where hotel_id = $1 order by code", [hotelId]);
    return {
      bills: rows.slice(0, cap).map((r) => ({
        id: r.id, orderNo: r.order_no, outlet: r.outlet, table: r.table_ref, status: r.status,
        businessDate: r.business_date, gross: Number(r.gross), payable: Number(r.payable),
        paymentMethod: r.payment_method,
        modes: r.modes.length ? r.modes : r.payment_method ? [r.payment_method] : [],
        openedAt: r.opened_at, lines: Number(r.lines),
        waiter: r.waiter, guest: r.customer_name, phone: r.customer_phone,
        settledAt: r.settled_at, stayGuest: r.stay_guest, room: r.stay_room,
      })),
      capped: rows.length > cap,
      cap,
      outlets,
    };
  });
  if (body && "forbidden" in body) return c.json({ error: body.forbidden }, 403);
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/** The floor's table a TYPED name means, in this outlet (QA POS-3): "AC2"
    typed at the till is table AC2 on Tables, or the two screens disagree
    about which tables are taken and a second bill opens beside the first.
    Null for a place the floor has no table for - "Poolside" is still an
    answer. */
async function tableNamed(
  client: Client, outletId: string, text: string | undefined,
): Promise<string | null> {
  if (!text?.trim()) return null;
  const { rows } = await client.query<{ id: string }>(
    `select t.id::text from pos_tables t
       join pos_sections s on s.id = t.section_id
      where s.outlet_id = $1 and t.is_active and lower(t.label) = lower($2)`,
    [outletId, text.trim()],
  );
  return rows[0]?.id ?? null;
}

/** The bill already running on a table, if any - or the one it was joined
    onto, until that is settled (D27-372). */
async function runningOn(client: Client, tableId: string): Promise<string | null> {
  const { rows } = await client.query<{ order_no: string }>(
    `select order_no from pos_orders
      where table_id = $1 and cleared_at is null and status = 'open'
     union all
     select order_no from app.pos_joined_to($1)
     limit 1`,
    [tableId],
  );
  return rows[0]?.order_no ?? null;
}

/* THE RESTAURANT'S DAY IS CLOSED (D27-118, the owner's answer of 28
   September). Once Close restaurant day has counted the drawer, a bill or a
   payment on that day would be money the count never saw. Refused until the
   night audit moves the date. */
async function dayClosed(client: Client, outletId: string, date: string): Promise<boolean> {
  const { rows } = await client.query<{ closed: boolean }>(
    `select exists (select 1 from pos_day_ends
                     where outlet_id = $1 and business_date = $2::date
                       and closed_at is not null) as closed`,
    [outletId, date],
  );
  return rows[0]!.closed;
}
const DAY_CLOSED =
  "The restaurant's day is closed and its drawer counted. New bills and " +
  "payments wait until the night audit moves the date.";

/* THE DAY OPENS BY ITSELF (the owner's D27-200, replacing D27-190's count-in):
   after the night audit an outlet's day is open on the float its last close
   kept, however many days back (app.pos_opening_cash, 165) - nothing to
   count, nothing to press. Null only on the outlet's FIRST-EVER day, when
   no close has kept a float yet: that one float is counted once (Open the
   day), and until it is no CASH is taken. */
/* A PAID-OUT WAITS FOR A YES (the owner's D27-239, D27-242): its latest
   decision in the approvals inbox, for the screen. */
const PAID_OUT_DECISION = (column: "status" | "decision_note") => `(
  select a.${column} from approvals a
   where a.subject_table = 'pos_cash_movements' and a.subject_id = m.id
   order by a.requested_at desc limit 1)`;

/** Paid-outs from the tin that day still waiting for a yes. */
async function paidOutsWaiting(client: Client, outletId: string, date: string): Promise<number> {
  const { rows } = await client.query<{ waiting: string }>(
    `select coalesce(sum(m.amount), 0)::text as waiting
       from pos_cash_movements m
      where m.outlet_id = $1 and m.business_date = $2::date and m.kind = 'expense'
        and ${PAID_OUT_DECISION("status")} in ('pending', 'clarify')`,
    [outletId, date]);
  return Number(rows[0]!.waiting);
}

async function openingCash(client: Client, outletId: string, date: string): Promise<number | null> {
  const { rows } = await client.query<{ opening: string | null }>(
    `select app.pos_opening_cash($1, $2::date)::text as opening`, [outletId, date]);
  return rows[0]!.opening === null ? null : Number(rows[0]!.opening);
}

till.post("/:code/till/orders", async (c) => {
  /* A PARCEL (the owner's D27-359): the takeaway type, named by the customer
     - required, so two parcels can be told apart - with a phone if given. */
  type OpenBody = { outlet?: string; table?: string; tableId?: string;
                    parcel?: { name?: string; phone?: string | null } };
  const input = await c.req.json<OpenBody>().catch(() => ({}) as OpenBody);
  if (!input.outlet) return c.json(refuse("Which outlet is this order for?"), 409);
  const parcelName = input.parcel ? input.parcel.name?.trim() ?? "" : null;
  const parcelPhone = input.parcel?.phone?.trim() || null;
  if (parcelName !== null) {
    if (!parcelName) return c.json(refuse("Whose parcel is it? Type the customer's name."), 409);
    if (parcelName.length > 60) return c.json(refuse("A customer's name is at most 60 characters."), 409);
    const badPhone = phoneProblem(parcelPhone);
    if (badPhone) return c.json(refuse(badPhone), 409);
    if (input.table || input.tableId) return c.json(refuse("A parcel has no table."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: outlet } = await client.query<{
      id: string; name: string;
      closed_until: string | null; closed_reason: string | null;
    }>(
      `select id::text, name, closed_until::text, closed_reason
         from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, input.outlet!.toUpperCase()],
    );
    if (!outlet[0]) {
      return refuse(`No active outlet with code ${input.outlet}.`);
    }

    /* THE STORE IS SHUT. Not the same as the module being off — that is
       a configuration change made in settings, and this is a Tuesday
       when the kitchen stopped serving early.

       Says WHEN it reopens, because a waiter refused with no time has
       to go and find somebody to ask. */
    if (outlet[0].closed_until
        && Date.parse(outlet[0].closed_until) > Date.now()) {
      const back = new Date(outlet[0].closed_until)
        .toLocaleString("en-IN", {
          weekday: "short", hour: "2-digit", minute: "2-digit",
        });
      return refuse(
        `${outlet[0].name} is closed` +
        `${outlet[0].closed_reason ? ` - ${outlet[0].closed_reason}` : ""}. ` +
        `Open again ${back}.`);
    }

    /* The hotel's operating day, resolved here. A waiter opening an
       order at 00:40 is serving the evening that has not closed yet. */
    const businessDate = await businessDateFor(client, hotelId);
    if (await dayClosed(client, outlet[0].id, businessDate)) return refuse(DAY_CLOSED);

    const { rows: no } = await client.query<{ order_no: string }>(
      `select app.pos_next_order_no($1, $2::date) as order_no`,
      [hotelId, businessDate],
    );

    /* A TABLE FROM THE FLOOR, or free text. Both are real: a floor plan
       does not have to cover everywhere food is served, and "Poolside"
       is still an answer. When a table IS named, its label is copied
       into table_ref so a bill reprinted next year reads the same even
       if the floor has been rearranged since. */
    let tableId: string | null = null;
    let tableRef: string | null = input.table?.trim() || null;
    const named = input.tableId || await tableNamed(client, outlet[0].id, input.table);

    if (named) {
      const { rows: t } = await client.query<{ id: string; label: string }>(
        `select t.id::text, t.label from pos_tables t
           join pos_sections s on s.id = t.section_id
          where t.id = $1 and s.outlet_id = $2 and t.is_active`,
        [named, outlet[0].id],
      );
      if (!t[0]) return refuse("That table is not in this outlet.");
      tableId = t[0].id;
      tableRef = t[0].label;

      /* Named before the unique index gets to it. Two open orders on one
         table is two bills nobody can tell apart, and the floor would
         show whichever came back first. */
      const busy = await runningOn(client, tableId);
      if (busy) return refuse(`${t[0].label} already has ${busy} running on it.`);
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_orders
         (hotel_id, outlet_id, order_no, table_ref, business_date, opened_by,
          table_id, order_type, customer_name, customer_phone)
       values ($1,$2,$3,$4,$5,$6,$7, coalesce($8, 'dine_in'), $9, $10)
       returning id::text`,
      [hotelId, outlet[0].id, no[0]!.order_no,
       parcelName !== null ? `Parcel · ${parcelName}` : tableRef,
       businessDate, session.staffId, tableId,
       parcelName !== null ? "takeaway" : null, parcelName, parcelPhone],
    );

    return { ok: true as const, ...(await readOrder(client, rows[0]!.id))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.get("/:code/till/orders/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    return await readOrder(client, c.req.param("id"));
  });

  return body ? c.json(body) : c.json({ error: "No such order." }, 404);
});

/* ══════════════════════════════════════════════════════════════════
   PUTTING ONE DISH ON A BILL

   ⚠ EXTRACTED FROM THE ROUTE BELOW SO THAT MORE THAN ONE CALLER CAN
   USE IT. There are 200 lines here — the item and its tax rate, whether
   it is sold by variation, which add-ons are allowed, and whether this
   dish merges into a line already on the bill. A second endpoint that
   needed the same thing had two options, and copying it was not one:
   the copy agrees on the day it is written and prices a dish
   differently six months later.

   Returns a refusal, or nothing at all when the line went on. The
   caller decides what to send back — a single add returns the order, a
   batch returns it once at the end rather than after every dish.
   ══════════════════════════════════════════════════════════════════ */
export interface LineInput {
  itemId?: string;
  qty?: number;
  note?: string;
  /* Chosen in the dish dialog, both optional. A dish with variations
     REQUIRES one and the database refuses without it; a dish with none
     must not be sent one. */
  variationId?: string;
  /* The choice of each further type, when the dish has more than one
     (D27-192): Large is the variation, Cheese burst and Thin are these. */
  moreChoiceIds?: string[];
  /** The Sides (045's add-on groups), each its own child line. */
  addonIds?: string[];
  /** The numbered Add-ons (D27-289): folded into THIS dish's line, "Veg
      Biryani with add-on Kebab". Optional: a round queued offline before
      them carries none, and goes on as it was. */
  numberedAddons?: NumberedChoice[];
  /** Add-ons as lines of their own under the dish (D27-291): typed ones,
      or numbered ones. With `extraFor`, under a dish already on this
      order instead of a new one - a dish the kitchen may already have. */
  extras?: ExtraInput[];
  /** The line, already on this order, that `extras` go under (D27-291). */
  extraFor?: string;
}

/* ── The bar orders from the bar (the owner's D27-324 (2)) ──────────
   A Bar person puts on a bill only a dish on the menu's Bar tab - its
   section sells under Bar or Alcohol, whichever KOT it prints on
   (app.pos_dish_at_bar, the owner's D27-329 (1)) - and raises the count of
   no other. Asked before anything is written (root MEMORY 243); the
   database refuses the rest behind it (the bar role's trigger). */
async function barRefusal(
  client: Client, hotelId: string, itemId: string,
): Promise<{ ok: false; reason: string } | null> {
  const { rows } = await client.query<{ ok: boolean; name: string | null }>(
    `select not app.pos_bar_only($1) or app.pos_dish_at_bar($1, $2::uuid) as ok,
            (select name from pos_menu_items where id = $2::uuid) as name`,
    [hotelId, itemId]);
  return rows[0]!.ok ? null
    : refuse(`${rows[0]!.name ?? "That dish"} is not on the bar's menu. A waiter orders it.`);
}

async function addOneLine(
  client: Client,
  session: { staffId: string },
  hotelId: string,
  orderId: string,
  input: LineInput,
): Promise<{ ok: false; reason: string } | null> {
  /* Validated HERE rather than by each caller. A quantity check that
     lives in the route is a check the batch endpoint would have to
     remember to repeat, and forgetting it puts a zero-quantity line on
     a real bill. */
  const qty = Number(input.qty ?? 1);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: "A quantity must be more than nothing." };
  }
  if (!input.itemId && input.extraFor === undefined) {
    return { ok: false, reason: "Which item?" };
  }


    /* Refuse in the API as well as the database. The trigger is the
       guarantee — it holds against every role — but a waiter who taps
       an item on a bill somebody just settled deserves the reason,
       not a constraint violation. Rule 6. */
    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(
        `This order is ${order[0].status}. A bill that has been paid cannot ` +
          `take another item - correct it with a credit, not by editing it.`,
      );
    }

    /* Add-ons on a dish already on this bill (D27-291), sent or not. */
    if (input.extraFor !== undefined) {
      return extrasUnder(client, session, hotelId, orderId, input.extraFor, input.extras);
    }

    const { rows: item } = await client.query<{
      name: string; price: string; tax_rate: string | null; is_active: boolean;
      off_until: string | null; off_reason: string | null;
      tax_kind: string; variation_count: string;
      tax_scheme: "gst" | "vat"; serves_alcohol: boolean;
    }>(
      /* THE ITEM'S OWN RATE, OR THE OUTLET'S RULE.
         `pos_menu_items.tax_rate` was `not null default 5.00` — a
         shipped tax rate, in a project whose first rule is that nothing
         ships a price. Every item created through the interface got 5%
         whether or not anybody had thought about it, and a bar built on
         this schema would have billed its whisky at the restaurant's
         rate without a word.

         Null now means "follow the outlet", which is what almost every
         item wants; an explicit rate remains for the real exception,
         bottled water on a food bill being the standard one. Resolved
         HERE, in the one place a line is written, so the two cannot
         disagree — and it is COPIED onto the line, so changing the rule
         next month does not re-tax a bill printed today.

         An outlet whose kind has no rule raises, and the refusal below
         turns that into a sentence a waiter can act on. That is how the
         bar stays honest until the owner sets its rate.

         ALCOHOL IS VAT (D21-91). A dish in a section taxed as alcohol that
         follows the section's rate is rung as VAT; one with its own rate is
         the section's exception and keeps that rate as GST - a soft drink
         sold beside the spirits, as bottled water is on a food bill. */
      `select i.name, i.price::text, i.is_active,
              i.off_until::text, i.off_reason,
              coalesce(c.tax_kind, 'other') as tax_kind,
              case when c.tax_kind = 'alcohol' and i.tax_rate is null
                   then 'vat' else 'gst' end as tax_scheme,
              app.module_enabled(i.hotel_id, 'alcohol') as serves_alcohol,
              ${DISH_TAX_RATE}::text as tax_rate,
              (select count(*)::text from pos_item_variations v
                where v.item_id = i.id and v.is_active and v.type_no = 1) as variation_count
         from pos_menu_items i
         join pos_menu_categories c on c.id = i.category_id
        where i.id = $1 and i.hotel_id = $2`,
      [input.itemId, hotelId],
    );
    if (!item[0]) return refuse("No such item on the menu.");
    const notTheBars = await barRefusal(client, hotelId, input.itemId!);
    if (notTheBars) return notTheBars;
    if (!item[0].is_active) {
      return refuse(`${item[0].name} is off the menu today.`);
    }
    /* "We are out of paneer", until a time. Says WHEN it comes back, so
       the waiter can tell the table rather than just be refused. */
    if (item[0].off_until && Date.parse(item[0].off_until) > Date.now()) {
      const back = new Date(item[0].off_until)
        .toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      return refuse(
        `${item[0].name} is off${item[0].off_reason ? ` - ${item[0].off_reason}` : ""}. ` +
        `Back after ${back}.`);
    }

    /* No rate, and no rule that covers it. Refused in a sentence rather
       than left to the database's exception, because the person holding
       the tablet needs to know which heading to go and set — not that
       something threw. This is the bar, on the day it opens and before
       anybody has told the system what a peg is taxed at. */
    /* A property that does not serve alcohol sells none (D21-90), whatever
       its sections were once set to. Asked before anything is written. */
    if (item[0].tax_kind === "alcohol" && !item[0].serves_alcohol) {
      return refuse(
        `${item[0].name} is in a section taxed as alcohol, and this property is `
        + "not switched on for alcohol. The owner or an administrator turns it on "
        + "in Settings, under Modules.");
    }
    if (item[0].tax_rate === null && item[0].tax_kind === "alcohol") {
      return refuse(
        `${item[0].name} has no VAT rate. Nothing is set for alcohol, and a `
        + "missing rate is not zero - set it in the GST and VAT card, under Settings → "
        + "Taxes and billing or Finance → Invoices.");
    }
    if (item[0].tax_rate === null) {
      const KIND: Record<string, string> = {
        bar: "the bar", restaurant: "the restaurant",
        banquet: "banqueting", other: "this category",
      };
      return refuse(
        `${item[0].name} has no GST rate. Nothing is set for `
        + `${KIND[item[0].tax_kind] ?? "this category"}, and a missing rate `
        + `is not zero - set it in the GST card, under Settings → Taxes and billing or Finance → Invoices.`);
    }

    /* THE PRICE COMES FROM THE VARIATION, NOT THE ITEM.

       A dish that gains an Oil and a Butter has a `price` column nobody
       has looked at since. Charging it would put a number on the bill
       that is on no menu — so the database refuses, and this names the
       reason before the constraint does. */
    let name = item[0].name;
    let unitPrice = item[0].price;
    let firstLabel: string | null = null;

    if (Number(item[0].variation_count) > 0) {
      if (!input.variationId) {
        return refuse(`${item[0].name} is sold by variation. Choose one.`);
      }
      const { rows: v } = await client.query<{ label: string; price: string }>(
        `select label, price::text from pos_item_variations
          where id = $1 and item_id = $2 and is_active and type_no = 1`,
        [input.variationId, input.itemId],
      );
      if (!v[0]) return refuse("That variation is not on this dish.");
      firstLabel = v[0].label;
      name = `${item[0].name} (${v[0].label})`;
      unitPrice = v[0].price;
    } else if (input.variationId) {
      return refuse(`${item[0].name} has no variations.`);
    }

    /* EACH FURTHER TYPE (D27-192): one choice of each, and its price is
       added to the first's - Large ₹400 + Cheese burst ₹80 is ₹480. The
       kitchen reads every choice in the name, Free ones too. */
    const wanted = input.moreChoiceIds ?? [];
    const { rows: types } = await client.query<{ type_no: number; heading: string }>(
      `select type_no, coalesce(max(heading), max(kind), 'variation') as heading
         from pos_item_variations
        where item_id = $1 and is_active and type_no > 1
        group by type_no order by type_no`,
      [input.itemId]);
    const { rows: more } = wanted.length === 0 ? { rows: [] } : await client.query<{
      id: string; type_no: number; label: string; price: string;
    }>(
      `select id::text, type_no, label, price::text from pos_item_variations
        where id = any($2::uuid[]) and item_id = $1 and is_active and type_no > 1
        order by type_no`,
      [input.itemId, wanted]);
    if (more.length !== wanted.length) return refuse("That choice is not on this dish.");
    for (const t of types) {
      if (more.filter((m) => m.type_no === t.type_no).length !== 1) {
        return refuse(`${item[0].name}: choose one ${t.heading.toLowerCase()}.`);
      }
    }
    if (more.length > 0) {
      const paise = (rupees: string) => Math.round(Number(rupees) * 100);
      unitPrice = ((paise(unitPrice) + more.reduce((sum, m) => sum + paise(m.price), 0))
        / 100).toFixed(2);
      name = `${item[0].name} (${[firstLabel, ...more.map((m) => m.label)]
        .filter(Boolean).join(", ")})`;
    }
    const extraChoiceIds = more.map((m) => m.id);

    /* ── The sides, checked BEFORE anything is written ────────────
       They were checked after the dish's line went in, and a refusal
       returned after a write is committed (root MEMORY 243): the single
       tap route put the dish on the bill without the sides its guest
       chose. So every refusal about them comes first. */
    const addonIds = input.addonIds ?? [];
    type Chosen = {
      id: string; label: string; price: string; group_id: string;
      group_label: string; off_until: string | null;
    };
    const chosen: Chosen[] = addonIds.length === 0 ? [] : (await client.query<Chosen>(
      `select a.id::text, a.label, a.price::text, g.id::text as group_id,
              g.label as group_label, a.off_until::text
         from pos_addons a
         join pos_addon_groups g on g.id = a.group_id
        where a.id = any($1::uuid[]) and a.hotel_id = $2 and a.is_active
          and exists (select 1 from pos_item_addon_groups ig
                       where ig.group_id = a.group_id and ig.item_id = $3)`,
      [addonIds, hotelId, input.itemId],
    )).rows;

    /* Named, not silently dropped. An add-on the guest asked for that
       does not reach the kitchen is a complaint at the table. */
    if (chosen.length !== addonIds.length) {
      return refuse(
        "One of those sides is not offered with this dish, or is off today.");
    }
    const offNow = chosen.find(
      (a) => a.off_until && Date.parse(a.off_until) > Date.now());
    if (offNow) return refuse(`${offNow.label} is off today.`);

    /* HOW MANY A GUEST MAY CHOOSE (D21-41) — each group the dish offers,
       counting only groups with an option to choose, as the pad shows. */
    const { rows: rules } = await client.query<{
      id: string; label: string; min_select: number; max_select: number | null;
    }>(
      `select g.id::text, g.label, g.min_select, g.max_select
         from pos_item_addon_groups ig
         join pos_addon_groups g on g.id = ig.group_id
        where ig.item_id = $1 and g.hotel_id = $2
          and exists (select 1 from pos_addons a
                       where a.group_id = g.id and a.is_active)`,
      [input.itemId, hotelId],
    );
    for (const g of rules) {
      const n = chosen.filter((a) => a.group_id === g.id).length;
      if (n < g.min_select) {
        return refuse(`${item[0].name}: choose ${
          g.min_select === 1 ? "one" : `at least ${g.min_select}`} from ${g.label}.`);
      }
      if (g.max_select !== null && n > g.max_select) {
        return refuse(`${item[0].name}: ${g.label} allows ${g.max_select}.`);
      }
    }

    /* ── The numbered add-ons (D27-289), also before anything is written ──
       Folded into THIS line, not lines of their own: "Veg Biryani with
       add-on Kebab", the dish's price and theirs together, at the dish's
       own tax rate (the owner: it is part of the dish). What they were is
       kept on the line, so the bill's breakdown and the kitchen's "+ Kebab"
       read from what was chosen, not from today's list. */
    const numbered = await numberedFor(client, hotelId, input.numberedAddons);
    if (!numbered.ok) return numbered;
    /* And the add-ons as lines of their own (D27-291), also before. */
    const extras = await extrasFor(client, hotelId, input.extras);
    if (!extras.ok) return extras;
    const kept: LineAddons | null = lineAddons(name, unitPrice, numbered.addons);
    name = nameWithAddons(name, numbered.addons);
    unitPrice = priceWithAddons(unitPrice, numbered.addons);

    /* Price and tax are COPIED onto the line. A menu price that rises
       next month must not silently re-price a bill printed today. */
      /* Increment first. Only if nothing matched does a row get added.
         THE SAME DISH IS THE SAME CHOICES (D27-189): the variation, the
         note and exactly these sides. A Bhaaji Pau with onions is not the
         same thing to a kitchen as one without, but a second one with
         onions is one more of it - with sides, this started a new line
         every time, so the same dish ordered twice read as two. The dish
         and its sides go up together. */
      /* A dish with a custom add-on of its own (D27-291) is never "one more"
         of anything: the papad is for this plate. */
      const { rows: same } = extras.extras.length > 0 ? { rows: [] } : await client.query<{ id: string }>(
        `update pos_order_lines
            set qty = qty + $1
          where id = (
            select l.id from pos_order_lines l
             where l.order_id = $2
               and l.item_id = $3
               and l.variation_id is not distinct from $5
               and l.parent_line_id is null
               and not l.voided
               /* NOT ONE THE KITCHEN HAS (the owner, 28 September). Raising a
                  sent line put the second plate on the bill and on no docket:
                  the guest paid for two and the kitchen's slip said one. An
                  extra after the send is a new line and goes on the next. */
               and l.kot_status = 'pending'
               and l.note is not distinct from $4
               and l.extra_choice_ids = $7::uuid[]
               and array(select a.addon_id from pos_order_lines a
                          where a.parent_line_id = l.id and not a.voided
                            and a.addon_id is not null
                          order by 1)
                 = array(select unnest($6::uuid[]) order by 1)
               /* Nor one carrying add-ons of its own (D27-291). */
               and not exists (select 1 from pos_order_lines x
                                where x.parent_line_id = l.id and not x.voided
                                  and x.extra_kind is not null)
               /* And exactly these numbered add-ons (D27-289): a Biryani with
                  Kebab is one more of a Biryani with Kebab, never of a plain
                  one. Kept in number order, so the same choice compares equal. */
               and l.numbered_addons is not distinct from $8::jsonb
             order by l.added_at limit 1)
          returning id::text`,
        [qty, orderId, input.itemId, input.note?.trim() || null,
         input.variationId ?? null, chosen.map((a) => a.id), extraChoiceIds,
         kept === null ? null : JSON.stringify(kept)],
      );
      if (same[0]) {
        await client.query(
          `update pos_order_lines set qty = qty + $1
            where parent_line_id = $2 and not voided and addon_id is not null`,
          [qty, same[0].id]);
      }
      const bumped = same.length;

      const added = !bumped ? await client.query<{ id: string }>(
      /* TAPPING THE SAME DISH TWICE MEANS TWO OF IT, NOT TWO LINES.

         This inserted unconditionally, so a table ordering six butter
         rotis produced six rows reading "1x Butter Roti" — six taps, six
         lines on the kitchen copy, six lines on the guest's bill. Every
         till in the trade increments instead, and a waiter expects it to.

         The match is on the item AND the note: "Paneer Tikka" and
         "Paneer Tikka, no chilli" are different things to a kitchen and
         must stay different rows. A struck line is not matched either —
         re-adding something that was cancelled starts fresh. */
      `insert into pos_order_lines
         (order_id, hotel_id, item_id, variation_id, name, qty, unit_price,
          tax_rate, tax_scheme, note, added_by, extra_choice_ids, numbered_addons)
       values ($1,$2,$3,$10,$4,$5,$6,$7,$11,$8,$9,$12,$13::jsonb)
       returning id`,
      [orderId, hotelId, input.itemId, name, qty,
       unitPrice, item[0].tax_rate, input.note?.trim() || null, session.staffId,
       input.variationId ?? null, item[0].tax_scheme, extraChoiceIds,
       kept === null ? null : JSON.stringify(kept)],
    ) : null;

    /* ── The sides, as child lines ────────────────────────────────
       An add-on is a LINE. It carries its own name, price, quantity and
       tax rate, so the totals, the discount apportionment and the
       per-rate folio posting all handle it without being taught
       anything new — and striking the dish strikes them, by trigger.

       Its own tax rate comes from the DISH, not the add-on: onions
       served on a plate of Bhaaji Pau are taxed as what they are part
       of, and a side sold at a different rate to the thing it garnishes
       would split one dish across two folio postings. */
    const parentId = added?.rows[0]?.id;
    if (parentId) {
      for (const a of chosen) {
        await client.query(
          `insert into pos_order_lines
             (order_id, hotel_id, addon_id, parent_line_id, name, qty,
              unit_price, tax_rate, tax_scheme, added_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$10,$9)`,
          [orderId, hotelId, a.id, parentId,
           `${a.group_label}: ${a.label}`, qty, a.price,
           item[0].tax_rate, session.staffId, item[0].tax_scheme],
        );
      }
      /* Its add-ons as lines of their own (D27-291), each with its own
         quantity, at the dish's tax. */
      await insertExtras(client, {
        orderId, hotelId, parentId, taxRate: item[0].tax_rate!,
        taxScheme: item[0].tax_scheme, staffId: session.staffId,
      }, extras.extras);
    }

  return null;
}

/* ── Add-ons under a dish already on the bill (D27-291) ─────────────
   The owner: "a thali comes to the table; they want one more thing from it
   that we don't offer" - a typed add-on, or one of the numbered list, under
   the dish, sent or not. It waits for the next Send like any new dish, and
   that KOT names the dish it is for. At the dish's own tax. Every refusal
   before the first write (root MEMORY 243). */
async function extrasUnder(
  client: Client, session: { staffId: string }, hotelId: string, orderId: string,
  lineId: unknown, wanted: unknown,
): Promise<{ ok: false; reason: string } | null> {
  if (typeof lineId !== "string" || !/^\d+$/.test(lineId)) return refuse("Which dish is it for?");
  const extras = await extrasFor(client, hotelId, wanted);
  if (!extras.ok) return extras;
  if (extras.extras.length === 0) return refuse("Which add-ons?");

  const { rows } = await client.query<{
    name: string; item_id: string | null; parent_line_id: string | null; voided: boolean;
    tax_rate: string; tax_scheme: string; numbered_addons: LineAddons | null;
  }>(
    `select name, item_id::text, parent_line_id::text, voided, tax_rate::text,
            tax_scheme, numbered_addons
       from pos_order_lines where id = $1 and order_id = $2
       for update`,
    [lineId, orderId],
  );
  const dish = rows[0];
  if (!dish) return refuse("That dish is not on this bill.");
  if (dish.parent_line_id || !dish.item_id) return refuse("Add-ons go on a dish, not on a side.");
  if (dish.voided) {
    return refuse(`${dish.numbered_addons?.dish ?? dish.name} was struck. Nothing was added to it.`);
  }

  await insertExtras(client, {
    orderId, hotelId, parentId: lineId, taxRate: dish.tax_rate,
    taxScheme: dish.tax_scheme, staffId: session.staffId,
  }, extras.extras);
  return null;
}

till.post("/:code/till/orders/:id/lines", async (c) => {
  const input = await c.req.json<LineInput>().catch(() => ({}) as LineInput);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const orderId = c.req.param("id");

    const refused = await addOneLine(
      client, session, hotelId, orderId, input);
    if (refused) return refused;

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── A dish the kitchen already has (D27-119, the owner, 28 September) ──
   Before the kitchen has it, anybody at the till may strike it: nothing has
   been cooked. After, it is food in the bin, so only these people may, and
   always with a reason - which the database keeps (151) and the docket, the
   Kitchen screen, Close restaurant day and the night audit show. Lowering a
   sent dish's quantity and closing a bill unpaid once any of it went to the
   kitchen are the same strike by other doors, and ask the same (the owner's
   answers of 28 September). Asked before anything is written (MEMORY 243). */
const STRIKES_SENT = ["owner", "admin", "gm", "hotel_manager", "kitchen_manager"];
const STRIKES_SENT_WHO =
  "the owner, an administrator, the GM, the hotel manager or the kitchen manager";

/** Null when a strike of food the kitchen has may go ahead; else why not. */
async function sentStrikeRefusal(
  client: Client, session: Session, hotelId: string, reason: string | undefined,
): Promise<string | null> {
  const role = session.isGroupAdmin ? "owner" : (await client.query<{ role: string }>(
    "select role from staff_hotels where staff_id = $1 and hotel_id = $2",
    [session.staffId, hotelId])).rows[0]?.role;
  if (!STRIKES_SENT.includes(role ?? "")) {
    return `The kitchen already has this. Only ${STRIKES_SENT_WHO} can take it off now.`;
  }
  return reason ? null : "The kitchen already has this. Why is it coming off?";
}

/** The day's dishes struck after the kitchen had them, with who and why -
    Close restaurant day (one outlet) and the night audit (the hotel) read
    this one list (151, D27-119). */
export async function struckAfterKitchen(
  client: Client, hotelId: string, businessDate: string, outletId?: string,
) {
  const { rows } = await client.query<{
    order_no: string; table_ref: string | null; name: string; qty: string;
    value: string; reason: string | null; struck_by: string | null; struck_at: string;
  }>(
    `select order_no, table_ref, name, qty::text, value::text, reason, struck_by,
            app.hotel_clock($1::uuid, struck_at, 'HH24:MI') as struck_at
       from app.pos_struck_after_kitchen($1, $2::date)
      where $3::uuid is null or outlet_id = $3::uuid`,
    [hotelId, businessDate, outletId ?? null],
  );
  return rows.map((r) => ({
    orderNo: r.order_no, table: r.table_ref, name: r.name, qty: Number(r.qty),
    value: Number(r.value), reason: r.reason, by: r.struck_by, at: r.struck_at,
  }));
}

/** Paid bills voided on a business day (D27-324): who, when, why, how much
    and how it had been paid. Close restaurant day, the night audit's run
    and its report read this one list; every sales figure leaves them out
    (they read `status = 'settled'`). */
export async function voidedBills(
  client: Client, hotelId: string, businessDate: string, outletId?: string,
) {
  const { rows } = await client.query<{
    order_no: string; table_ref: string | null; outlet: string; amount: string;
    method: string | null; cash: string; reason: string; reference: string | null;
    by: string | null; at: string;
  }>(
    `select o.order_no, o.table_ref, ou.name as outlet,
            (select payable from app.pos_order_total(o.id))::text as amount,
            o.payment_method as method,
            (select coalesce(sum(t.amount), 0) from pos_order_tenders t
              where t.order_id = o.id and t.method = 'cash')::text as cash,
            o.void_reason as reason, o.void_reference as reference,
            -- A colleague's name through app.hotel_people (149), as the
            -- reports read it: staff shows a clerk only their own row.
            coalesce(s.full_name, hp.full_name) as by,
            to_char(o.voided_at at time zone h.timezone, 'HH24:MI') as at
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       join hotels h on h.id = o.hotel_id
       left join staff s on s.id = o.voided_by
       left join app.hotel_people($1) hp on hp.id = o.voided_by
      where o.hotel_id = $1 and o.business_date = $2::date and o.status = 'void'
        and ($3::uuid is null or o.outlet_id = $3::uuid)
      order by o.voided_at`,
    [hotelId, businessDate, outletId ?? null],
  );
  return rows.map((r) => ({
    orderNo: r.order_no, table: r.table_ref, outlet: r.outlet, amount: Number(r.amount),
    method: r.method, cash: Number(r.cash), reason: r.reason, reference: r.reference,
    by: r.by, at: r.at,
  }));
}

/** Bills given free, NC, on a business day (D27-351): who gave it, when and
    why - no value, as the owner asked. Close restaurant day, the night
    audit's run and its report read this one list; every sales figure leaves
    them out (they read `status = 'settled'`). */
export async function noChargeBills(
  client: Client, hotelId: string, businessDate: string, outletId?: string,
) {
  const { rows } = await client.query<{
    order_no: string; table_ref: string | null; outlet: string; reason: string;
    by: string | null; at: string;
  }>(
    `select o.order_no, o.table_ref, ou.name as outlet, o.nc_reason as reason,
            coalesce(s.full_name, hp.full_name) as by,
            to_char(o.nc_at at time zone h.timezone, 'HH24:MI') as at
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       join hotels h on h.id = o.hotel_id
       left join staff s on s.id = o.nc_by
       left join app.hotel_people($1) hp on hp.id = o.nc_by
      where o.hotel_id = $1 and o.business_date = $2::date and o.status = 'no_charge'
        and ($3::uuid is null or o.outlet_id = $3::uuid)
      order by o.nc_at`,
    [hotelId, businessDate, outletId ?? null],
  );
  return rows.map((r) => ({
    orderNo: r.order_no, table: r.table_ref, outlet: r.outlet, reason: r.reason,
    by: r.by, at: r.at,
  }));
}

/** What each outlet sold per business day, BEFORE GST - the till's own
    `taxable` (lines less discount), settled bills only. The Store sets the
    stock issued to an outlet against it (D27-238). Unlike reports' posSales,
    a bill charged to a room or to a function COUNTS: it was food sold here,
    whichever folio it went to. Read only. */
export async function outletSales(
  client: Client, hotelId: string, from: string, to: string,
): Promise<{ outletId: string; date: string; net: number }[]> {
  const { rows } = await client.query<{ outlet_id: string; date: string; net: string }>(
    `select o.outlet_id::text, to_char(o.business_date, 'YYYY-MM-DD') as date,
            sum(t.taxable)::text as net
       from pos_orders o
       cross join lateral app.pos_order_total(o.id) t
      where o.hotel_id = $1 and o.status = 'settled'
        and o.business_date between $2::date and $3::date
      group by 1, 2
      order by 2, 1`,
    [hotelId, from, to],
  );
  return rows.map((r) => ({ outletId: r.outlet_id, date: r.date, net: Number(r.net) }));
}

type Act = { ok: true } | { ok: false; reason: string };

/** A line struck - by the till's X, or by the GM approving a waiter's
    request (D27-363): the same checks either way, as `session`. */
export async function strikeLine(
  client: Client, session: Session, hotelId: string, orderId: string, lineId: string, reason: string | undefined,
): Promise<Act> {
    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    const { rows: line } = await client.query<{ sent: boolean }>(
      `select kot_status <> 'pending' as sent from pos_order_lines
        where id = $1 and order_id = $2 and not voided
        for update`,
      [lineId, orderId],
    );
    if (!line[0]) return refuse("That line is already struck, or is not here.");
    if (line[0].sent) {
      const why = await sentStrikeRefusal(client, session, hotelId, reason);
      if (why) return refuse(why);
    }

    /* Struck, not removed. A waiter adding and cancelling the same
       dish four times is exactly what a manager investigating a
       dispute wants to be able to see. */
    const { rowCount } = await client.query(
      `update pos_order_lines
          set voided = true, voided_by = $1, voided_at = now(), void_reason = $4
        where id = $2 and order_id = $3 and not voided`,
      [session.staffId, lineId, orderId, reason ?? null],
    );
    if (!rowCount) return refuse("That line is already struck, or is not here.");
    return { ok: true };
}

till.post("/:code/till/orders/:id/lines/:lineId/void", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim() || undefined;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const done = await strikeLine(client, session, hotelId, orderId, c.req.param("lineId"), reason);
    if (!done.ok) return done;
    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The discount ─────────────────────────────────────────────────
   A discount is allowed and it must say WHY. A till with nowhere to
   record one does not stop discounts happening — it moves them
   somewhere invisible, and the biller voids a line instead. */

/** What is wrong with a discount as asked, or null. */
export function discountProblem(type: unknown, rawValue: unknown, rawReason: unknown): string | null {
  if (type !== "percent" && type !== "fixed") return "A discount is a percentage or a fixed amount.";
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return "How much is the discount?";
  if (type === "percent" && value > 100) return "More than 100% is a refund, not a discount.";
  /* The reason is the whole point. An amount with nobody's explanation
     attached is an unauditable hole in revenue, which is worse than
     not offering the feature at all. */
  if (typeof rawReason !== "string" || !rawReason.trim()) {
    return "Why is this discounted? A staff meal, a complaint, a manager's call.";
  }
  return null;
}

/** A discount put on an open bill - by a manager at the till, or by the GM
    approving a waiter's request (D27-363). Checked by discountProblem first. */
export async function discountOrder(
  client: Client, orderId: string, hotelId: string, type: "percent" | "fixed", value: number, reason: string,
): Promise<Act> {
    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    const { rows: t } = await client.query<{ net: string }>(
      `select net::text from app.pos_order_total($1)`, [orderId]);
    if (Number(t[0]!.net) <= 0) {
      return refuse("There is nothing on this order to discount.");
    }

    /* A percentage is resolved to money ONCE, here, and stored. Never
       recomputed on read: a bill printed at 10% off would silently
       change the moment somebody added a line to the order. */
    const amount = type === "percent"
      ? (await client.query<{ amount: string }>(
          `select app.pos_discount_for($1, $2)::text as amount`,
          [orderId, value])).rows[0]!.amount
      : value;

    /* ⚠ THE CAP, AND IT IS THE DATABASE'S NUMBER. Read rather than
       written here, because the till shows the same figure in the
       discount dialog and a second copy is a second thing to be wrong.

       Checked on the MONEY, not on the percentage, so a fixed amount
       cannot walk around it: ₹5,000 off a ₹6,000 bill is 83% however
       it was typed. */
    const { rows: capRow } = await client.query<{ cap: string }>(
      "select app.pos_freehand_discount_cap()::text as cap");
    const cap = Number(capRow[0]!.cap);
    const ceiling = Number(t[0]!.net) * cap / 100;

    if (Number(amount) > ceiling + 0.005) {
      return refuse(
        `A biller may take off up to ${cap}% - ₹${ceiling.toLocaleString(
          "en-IN", { maximumFractionDigits: 2 })} on this `
        + "bill. Anything larger goes on as a named promotion, so it is the "
        + "same concession every time and the month-end report can count it.");
    }

    await client.query(
      `update pos_orders
          set discount_type = $1, discount_value = $2,
              discount_amount = $3, discount_reason = $4,
              /* ⚠ AND THE PROMOTION IS CLEARED. Overwriting a promotion
                 with a free-hand discount and leaving promotion_id behind
                 would report the concession as still given. */
              promotion_id = null, updated_at = now()
        where id = $5`,
      [type, value, amount, reason, orderId],
    );
    return { ok: true };
}

till.post("/:code/till/orders/:id/discount", async (c) => {
  type DiscountBody = { type?: string; value?: number; reason?: string };
  const input = await c.req.json<DiscountBody>().catch(() => ({}) as DiscountBody);
  const problem = discountProblem(input.type, input.value, input.reason);
  if (problem) return c.json(refuse(problem), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const done = await discountOrder(client, orderId, hotelId, input.type as "percent" | "fixed",
      Number(input.value), input.reason!.trim());
    if (!done.ok) return done;
    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── A named promotion ─────────────────────────────────────────────
   The owner's answer to "what happens above the cap": not an approval
   queue somebody answers again every night, but a policy decided once
   and applied by code.

   "The owner's guests eat at 50%" is not a decision, it is a rule. A
   rule typed in fresh by a biller at 11pm is a rule that drifts, and a
   free-hand discount with "owner's friends" in the reason box makes
   "what did that cost us in September" a search through text nobody
   spelled the same way twice.
   ═══════════════════════════════════════════════════════════════════ */
till.post("/:code/till/orders/:id/promotion", async (c) => {
  type Body = { code?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const promoCode = input.code?.trim();
  if (!promoCode) return c.json(refuse("Which promotion?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      "select status from pos_orders where id = $1 and hotel_id = $2",
      [orderId, hotelId]);
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    const { rows: promo } = await client.query<{
      id: string; name: string; kind: string; value: string;
      is_active: boolean;
    }>(
      `select id::text, name, kind, value::text, is_active
         from pos_promotions
        where hotel_id = $1 and lower(trim(code)) = lower(trim($2))`,
      [hotelId, promoCode]);
    if (!promo[0]) {
      return refuse(`There is no promotion with the code ${promoCode}.`);
    }
    if (!promo[0].is_active) {
      return refuse(`${promo[0].name} is not running any more.`);
    }

    const { rows: t } = await client.query<{ net: string }>(
      "select net::text from app.pos_order_total($1)", [orderId]);
    if (Number(t[0]!.net) <= 0) {
      return refuse("There is nothing on this order to discount.");
    }

    /* Resolved to money ONCE, here, exactly as a free-hand percentage
       is. A bill printed at 50% off must not change because somebody
       added a line to the order afterwards. */
    const amount = promo[0].kind === "percent"
      ? (await client.query<{ amount: string }>(
          "select app.pos_discount_for($1, $2)::text as amount",
          [orderId, promo[0].value])).rows[0]!.amount
      : promo[0].value;

    if (Number(amount) > Number(t[0]!.net)) {
      /* A ₹500 promotion on a ₹300 bill. The promotion is not wrong —
         this bill is simply smaller than it — and a negative payable
         is not a thing a till may produce. */
      return refuse(
        `${promo[0].name} takes off more than this bill comes to.`);
    }

    await client.query(
      `update pos_orders
          set discount_type = $1, discount_value = $2, discount_amount = $3,
              /* The promotion's NAME is the reason, so the bill and the
                 record say the same words without anybody typing them. */
              discount_reason = $4, promotion_id = $5, updated_at = now()
        where id = $6`,
      [promo[0].kind, promo[0].value, amount, promo[0].name, promo[0].id,
       orderId]);

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/discount/clear", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rowCount } = await client.query(
      `update pos_orders
          set discount_type = null, discount_value = null,
              discount_amount = 0, discount_reason = null,
              /* The promotion goes with it. A cleared discount that
                 still points at "Owner's guests" would report a
                 concession that is no longer on the bill. */
              promotion_id = null, updated_at = now()
        where id = $1 and hotel_id = $2 and status = 'open'`,
      [orderId, hotelId],
    );
    if (!rowCount) return refuse("No open order here, or it is already settled.");

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The promotions themselves ─────────────────────────────────────
   Managed on the menu screen, beside the dishes and the taxes, because
   it is the same question: what does this restaurant sell and on what
   terms.

   ⚠ THE CAP TRAVELS WITH THE LIST. The discount dialog has to show
   "up to 10% — ₹247 on this bill" before a biller types a number, and
   the alternative to sending it here is a second copy of 10 in the
   browser. There is one number, in 083, and everything reads it.
   ═══════════════════════════════════════════════════════════════════ */
till.get("/:code/till/promotions", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; code: string; name: string; kind: string;
      value: string; is_active: boolean; used: string;
    }>(
      `select p.id::text, p.code, p.name, p.kind, p.value::text, p.is_active,
              (select count(*) from pos_orders o
                where o.promotion_id = p.id)::text as used
         from pos_promotions p
        where p.hotel_id = $1
        order by p.is_active desc, lower(p.code)`,
      [hotelId]);

    const { rows: capRow } = await client.query<{ cap: string }>(
      "select app.pos_freehand_discount_cap()::text as cap");

    return {
      freehandCapPercent: Number(capRow[0]!.cap),
      promotions: rows.map((r) => ({
        id: r.id, code: r.code, name: r.name,
        kind: r.kind as "percent" | "fixed",
        value: Number(r.value),
        isActive: r.is_active,
        used: Number(r.used),
      })),
    };
  });
  return body === null ? c.json({ error: "No such property." }, 404)
                       : c.json(body);
});

till.post("/:code/till/promotions", async (c) => {
  type Body = { code?: string; name?: string; kind?: string; value?: number };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const promoCode = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!promoCode) return c.json(refuse("What code does the biller type?"), 409);
  if (!/^[A-Z0-9]{2,12}$/.test(promoCode)) {
    return c.json(refuse(
      "Two to twelve letters or digits - it is typed at a terminal with a "
      + "queue behind it."), 409);
  }
  if (!name) {
    return c.json(refuse("What is it called? It prints on the bill."), 409);
  }
  if (input.kind !== "percent" && input.kind !== "fixed") {
    return c.json(refuse("A percentage off, or an amount off."), 409);
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    return c.json(refuse(
      "How much does it take off? A promotion worth nothing prints "
      + "−₹0.00 on a bill."), 409);
  }
  if (input.kind === "percent" && value > 100) {
    return c.json(refuse("More than 100% is a refund, not a discount."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into pos_promotions (hotel_id, code, name, kind, value)
         values ($1,$2,$3,$4,$5) returning id::text`,
        [hotelId, promoCode, name, input.kind, value.toFixed(2)]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        return refuse(`${promoCode} is already in use here.`);
      }
      throw e;
    }
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.patch("/:code/till/promotions/:id", async (c) => {
  type Body = { name?: string; value?: number; isActive?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  if (input.name !== undefined && !input.name.trim()) {
    return c.json(refuse("A promotion with no name prints nothing."), 409);
  }
  if (input.value !== undefined
      && (!Number.isFinite(input.value) || input.value <= 0)) {
    return c.json(refuse("How much does it take off?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* ⚠ THE CODE IS NOT CHANGEABLE, and that is deliberate. Bills
       already printed say "OWNG"; a code reused for something else
       makes last month's bills describe this month's policy. Switch
       the old one off and make a new one. */
    const { rowCount } = await client.query(
      `update pos_promotions
          set name      = coalesce($1, name),
              value     = coalesce($2, value),
              is_active = coalesce($3, is_active)
        where id = $4 and hotel_id = $5`,
      [input.name?.trim() ?? null,
       input.value === undefined ? null : input.value.toFixed(2),
       input.isActive ?? null, c.req.param("id"), hotelId]);
    if (!rowCount) return refuse("No such promotion here.");
    return { ok: true as const };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ── Round off ────────────────────────────────────────────────────
   To the nearest rupee, so the biller takes a note rather than
   counting coins. Its own column because it is its own line on the
   bill and its own row in the day book — and the database caps it
   under a rupee so it cannot become a discount avoiding the reason. */

till.post("/:code/till/orders/:id/round-off", async (c) => {
  type RoundBody = { apply?: boolean };
  const input = await c.req.json<RoundBody>().catch(() => ({}) as RoundBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    /* THE HOTEL'S ROUND-OFF (192, the owner's D27-260 Q4): Off, the button
       is refused; taking one off still works. */
    if (input.apply !== false && (await client.query<{ r: string }>(
      "select pos_round_off as r from hotels where id = $1", [hotelId])).rows[0]?.r === "off") {
      return refuse("Round-off is off at this hotel (Settings, Front desk).");
    }

    if (input.apply === false) {
      await client.query(
        `update pos_orders set round_off = 0, updated_at = now() where id = $1`,
        [orderId]);
      return { ok: true as const, ...(await readOrder(client, orderId))! };
    }

    /* Computed from the gross, with round_off already zeroed, so
       applying it twice does not compound. */
    await client.query(
      `update pos_orders set round_off = 0 where id = $1`, [orderId]);

    const { rows: t } = await client.query<{ gross: string }>(
      `select gross::text from app.pos_order_total($1)`, [orderId]);
    const gross = Number(t[0]!.gross);
    const adjustment = Math.round(gross) - gross;

    await client.query(
      `update pos_orders set round_off = $1, updated_at = now() where id = $2`,
      [adjustment.toFixed(2), orderId],
    );

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── Off, and back on ─────────────────────────────────────────────
   The most-used menu action in a live kitchen, and the one that has to
   take three seconds: paneer runs out mid-service and a waiter is
   already at a table asking for it.

   A DURATION, not a switch. "Off" with no end is a dish that stays off
   for a week because the person who took it off went home. The choices
   are the ones a kitchen actually thinks in — a couple of hours, the
   rest of the shift, the rest of the day. */

/** Turns what the screen offers into the moment it comes back. */
function offUntilFor(
  choice: string | undefined, custom: string | undefined,
  businessDate: string,
): Date | null | "bad" {
  switch (choice) {
    case "2h":  return new Date(Date.now() + 2 * 3600_000);
    case "4h":  return new Date(Date.now() + 4 * 3600_000);
    case "8h":  return new Date(Date.now() + 8 * 3600_000);
    case "24h": return new Date(Date.now() + 24 * 3600_000);
    case "next_business_day":
      /* Midnight ending the hotel's operating day, plus a whole day.
         Deliberately the BUSINESS date and not the clock: a kitchen
         closing out at 00:40 is still working yesterday's service, and
         "back tomorrow" must not mean "back in twenty minutes". */
      return new Date(
        Date.parse(`${businessDate}T00:00:00Z`) + 2 * 86_400_000);
    case "custom": {
      if (!custom) return "bad";
      const at = Date.parse(custom);
      if (!Number.isFinite(at) || at <= Date.now()) return "bad";
      return new Date(at);
    }
    default: return "bad";
  }
}

till.post("/:code/till/menu/items/:id/off", async (c) => {
  type OffBody = { until?: string; customUntil?: string; reason?: string };
  const input = await c.req.json<OffBody>().catch(() => ({}) as OffBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);
    const until = offUntilFor(input.until, input.customUntil, businessDate);
    if (until === "bad") {
      return refuse("For how long - two hours, four, eight, the rest of the day?");
    }

    const { rowCount } = await client.query(
      `update pos_menu_items
          set off_until = $1, off_reason = $2, updated_at = now()
        where id = $3 and hotel_id = $4`,
      [until, input.reason?.trim() || null, c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such item on the menu.");

    return { ok: true as const, offUntil: until?.toISOString() ?? null };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/menu/items/:id/on", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Cleared, not set to now(). A past timestamp reads as "it was off
       until then", which is a fact nobody needs and which makes the
       five states on the screen ambiguous. */
    const { rowCount } = await client.query(
      `update pos_menu_items
          set off_until = null, off_reason = null, updated_at = now()
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such item on the menu.");

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/addons/:id/off", async (c) => {
  type OffBody = { until?: string; customUntil?: string };
  const input = await c.req.json<OffBody>().catch(() => ({}) as OffBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const businessDate = await businessDateFor(client, hotelId);
    const until = offUntilFor(input.until, input.customUntil, businessDate);
    if (until === "bad") return refuse("For how long?");

    const { rowCount } = await client.query(
      `update pos_addons set off_until = $1 where id = $2 and hotel_id = $3`,
      [until, c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such add-on.");
    return { ok: true as const, offUntil: until?.toISOString() ?? null };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/addons/:id/on", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update pos_addons set off_until = null where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such add-on.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ══════════════════════════════════════════════════════════════════
   THE NUMBERED ADD-ONS LIST (the owner's D27-289)

   The Menu screen's Add-ons tab: number, name, price, a line on what it
   is. Whoever edits the menu manages them (roleGate MENU); the order
   screens read the ones in use (MENU_READ). The number is typed and is
   what staff remember, so it is not given to a second add-on while the
   first is in use, and it never changes - an add-on that goes is switched
   off. Not the Sides: those are 045's add-on groups, above.
   ══════════════════════════════════════════════════════════════════ */
type NumberedRow = {
  id: string; number: number; name: string; description: string | null;
  price: string; is_free: boolean; is_active: boolean;
  off_until: string | null; off_reason: string | null;
};
const numberedOut = (r: NumberedRow) => ({
  id: r.id, number: r.number, name: r.name, description: r.description,
  price: Number(r.price), free: r.is_free, isActive: r.is_active,
  offUntil: r.off_until, offReason: r.off_reason,
});
const NUMBERED_COLS = `id::text, number, name, description, price::text, is_free,
                       is_active, off_until::text, off_reason`;

/** The same, when the number went to somebody else's save a moment ago. */
const NUMBER_RACE = (n: number) =>
  `Add-on ${n} was just given to another add-on on another screen. Choose another number.`;

/** Who already has this number, in a sentence - or null. */
async function numberTaken(client: Client, hotelId: string, n: number, notId?: string) {
  const { rows } = await client.query<{ name: string }>(
    `select name from pos_numbered_addons
      where hotel_id = $1 and number = $2 and is_active
        and ($3::uuid is null or id <> $3::uuid)`,
    [hotelId, n, notId ?? null]);
  return rows[0]
    ? `Add-on ${n} is ${rows[0].name}. Staff know it by that number: choose another, `
      + `or switch ${rows[0].name} off first.`
    : null;
}

till.get("/:code/till/numbered-addons", async (c) => {
  /* The order screens want the ones in use; the Menu tab asks for all,
     switched-off ones included, so one can be brought back. */
  const all = c.req.query("all") === "1";
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<NumberedRow>(
      `select ${NUMBERED_COLS} from pos_numbered_addons
        where hotel_id = $1 and ($2 or is_active)
        order by is_active desc, number, name`,
      [hotelId, all]);
    return { addons: rows.map(numberedOut) };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── The custom add-ons used (the owner's D27-291) ──────────────────
   What staff typed in Customise these thirty days, one row per name and
   price, most used first, with who: the Add-ons tab lists them so the
   common ones can become numbered add-ons. Read only; nothing joins the menu
   by itself. Struck lines are not counted - they were not sold. */
const CUSTOM_DAYS = 30;

till.get("/:code/till/custom-addons-used", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      name: string; price: string; times: number; qty: string;
      last_at: string; who: string | null;
    }>(
      `select min(l.name) as name, l.unit_price::text as price,
              count(*)::int as times, sum(l.qty)::text as qty,
              max(l.added_at)::text as last_at,
              string_agg(distinct s.full_name, ', ') as who
         from pos_order_lines l
         left join staff s on s.id = l.added_by
        where l.hotel_id = $1 and l.extra_kind = 'custom' and not l.voided
          and l.added_at >= now() - make_interval(days => $2)
        group by lower(l.name), l.unit_price
        order by count(*) desc, max(l.added_at) desc
        limit 100`,
      [hotelId, CUSTOM_DAYS],
    );
    return {
      days: CUSTOM_DAYS,
      used: rows.map((r) => ({
        name: r.name, price: Number(r.price), times: r.times, qty: Number(r.qty),
        lastAt: r.last_at, by: r.who,
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/till/numbered-addons", async (c) => {
  type Body = { number?: number; name?: string; description?: string; price?: number | string | null; free?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const number = Number(input.number);
  const name = input.name?.trim();
  const description = input.description?.trim() || null;
  const free = input.free === true;
  const price = input.price === undefined || input.price === null || input.price === ""
    ? null : Number(input.price);

  if (!Number.isInteger(number) || number < 1 || number > 999) {
    return c.json(refuse("The number staff will tap: a whole number from 1 to 999."), 409);
  }
  if (!name) return c.json(refuse("What is add-on " + number + " called?"), 409);
  /* No default price (D27-120): typed, and 0 only when ticked Free. */
  if (price === null && !free) {
    return c.json(refuse(`What does ${name} cost? Type a price, or tick Free.`), 409);
  }
  const bad = priceProblem(price ?? 0, free);
  if (bad) return c.json(refuse(bad), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const taken = await numberTaken(client, hotelId, number);
    if (taken) return refuse(taken);
    try {
      const { rows } = await client.query<NumberedRow>(
        `insert into pos_numbered_addons (hotel_id, number, name, description, price, is_free)
         values ($1, $2, $3, $4, $5, $6)
         returning ${NUMBERED_COLS}`,
        /* Free is 0, whatever else was sent: a tile reading Free must not
           bill a price (the audit of 9 October). */
        [hotelId, number, name, description, free ? 0 : price ?? 0, free]);
      return { ok: true as const, addon: numberedOut(rows[0]!) };
    } catch (error) {
      /* Two people saving the same number at the same moment: the second
         meets the one-per-number index after the check above. A sentence,
         not a 500 - and nothing was written. */
      if ((error as { code?: string }).code === "23505") return refuse(NUMBER_RACE(number));
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.patch("/:code/till/numbered-addons/:id", async (c) => {
  /* The number is not here on purpose: it is what staff remember, and a
     2 that quietly becomes a 7 is a wrong plate at a table. */
  type Body = { name?: string; description?: string | null; price?: number | string | null; free?: boolean; active?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: was } = await client.query<NumberedRow>(
      `select ${NUMBERED_COLS} from pos_numbered_addons
        where id = $1 and hotel_id = $2 for update`,
      [c.req.param("id"), hotelId]);
    if (!was[0]) return refuse("No such add-on.");

    const name = input.name === undefined ? was[0].name : input.name.trim();
    if (!name) return refuse(`What is add-on ${was[0].number} called?`);
    const description = input.description === undefined
      ? was[0].description : (input.description?.trim() || null);
    const free = input.free === undefined ? was[0].is_free : input.free === true;
    const price = input.price === undefined ? Number(was[0].price)
      : input.price === null || input.price === "" ? null : Number(input.price);
    if (price === null && !free) {
      return refuse(`What does ${name} cost? Type a price, or tick Free.`);
    }
    const bad = priceProblem(price ?? 0, free);
    if (bad) return refuse(bad);
    const active = input.active === undefined ? was[0].is_active : input.active === true;
    /* Back on: its number must still be free. */
    if (active && !was[0].is_active) {
      const taken = await numberTaken(client, hotelId, was[0].number, was[0].id);
      if (taken) return refuse(taken);
    }

    try {
      const { rows } = await client.query<NumberedRow>(
        `update pos_numbered_addons
            set name = $1, description = $2, price = $3, is_free = $4, is_active = $5
          where id = $6
          returning ${NUMBERED_COLS}`,
        [name, description, free ? 0 : price ?? 0, free, active, was[0].id]);
      return { ok: true as const, addon: numberedOut(rows[0]!) };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return refuse(NUMBER_RACE(was[0].number));
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* Off for a while ("no kebabs until eight"), as a dish is: the same choices. */
till.post("/:code/till/numbered-addons/:id/off", async (c) => {
  type OffBody = { until?: string; customUntil?: string; reason?: string };
  const input = await c.req.json<OffBody>().catch(() => ({}) as OffBody);
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const until = offUntilFor(input.until, input.customUntil, await businessDateFor(client, hotelId));
    if (until === "bad") {
      return refuse("For how long - two hours, four, eight, the rest of the day?");
    }
    const { rowCount } = await client.query(
      `update pos_numbered_addons set off_until = $1, off_reason = $2
        where id = $3 and hotel_id = $4`,
      [until, input.reason?.trim() || null, c.req.param("id"), hotelId]);
    if (!rowCount) return refuse("No such add-on.");
    return { ok: true as const, offUntil: until?.toISOString() ?? null };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/numbered-addons/:id/on", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update pos_numbered_addons set off_until = null, off_reason = null
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!rowCount) return refuse("No such add-on.");
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The store itself ─────────────────────────────────────────────
   A kitchen that has stopped serving, without turning the whole module
   off in settings — that is a configuration change, and this is a
   Tuesday. */

till.post("/:code/till/outlet/:outlet/closed", async (c) => {
  type ClosedBody = {
    closed?: boolean; until?: string; customUntil?: string; reason?: string;
  };
  const input = await c.req.json<ClosedBody>().catch(() => ({}) as ClosedBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (input.closed === false) {
      const { rowCount } = await client.query(
        `update pos_outlets set closed_until = null, closed_reason = null
          where code = upper($1) and hotel_id = $2`,
        [c.req.param("outlet"), hotelId]);
      if (!rowCount) return refuse("No such outlet.");
      return { ok: true as const, closedUntil: null };
    }

    const businessDate = await businessDateFor(client, hotelId);
    const until = offUntilFor(input.until, input.customUntil, businessDate);
    if (until === "bad") return refuse("Closed until when?");

    const { rowCount } = await client.query(
      `update pos_outlets set closed_until = $1, closed_reason = $2
        where code = upper($3) and hotel_id = $4`,
      [until, input.reason?.trim() || null, c.req.param("outlet"), hotelId]);
    if (!rowCount) return refuse("No such outlet.");

    return { ok: true as const, closedUntil: until?.toISOString() ?? null };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── The floor ────────────────────────────────────────────────────
   Every table with whatever is sitting on it, in ONE request. A grid
   that fetches a tile at a time flickers as it fills, and a waiter
   reads the whole room at once or not at all. */

till.get("/:code/till/floor", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const code = (c.req.query("outlet") ?? "REST").toUpperCase();
    const { rows: outlet } = await client.query<{
      id: string; name: string;
      closed_until: string | null; closed_reason: string | null;
    }>(
      /* ⚠ AND THE REASON. The refusal a waiter gets when they try to
         ring an order has always carried it — "Kitchen closed — power
         cut". The banner on the floor, which is what a manager reads,
         said only that it was closed, so the two disagreed about how
         much they knew. */
      `select id::text, name, closed_until::text, closed_reason
         from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, code],
    );
    if (!outlet[0]) return { sections: [], outlet: null };

    const { rows } = await client.query<{
      section_id: string; section: string; table_id: string; label: string;
      seats: number | null; row_no: number; col_no: number;
      order_id: string | null; order_no: string | null; state: string;
      minutes: number | null; payable: string | null; ready: string;
      ready_ids: string[]; joined_to: string | null;
    }>(
      /* A JOINED TABLE (D27-372) shows the bill it went onto - "joined to
         AC3" - until that bill is settled or closed; then it is free. */
      `select section_id::text, section, table_id::text, label, seats,
              row_no, col_no, coalesce(f.order_id, j.order_id)::text as order_id,
              coalesce(f.order_no, j.order_no) as order_no,
              case when j.order_id is null then state else 'joined' end as state,
              minutes, payable::text, j.table_ref as joined_to,
              /* Dishes the kitchen has made Ready and nobody has Taken
                 (D27-221): what the waiter walks to the pass for. Dishes,
                 not their sides - but an add-on line (D27-291) is carried
                 out on its own, so it counts. */
              (select coalesce(sum(l.qty), 0) from pos_order_lines l
                where l.order_id = f.order_id and l.kot_status = 'ready'
                  and not l.voided
                  and (l.parent_line_id is null or l.extra_kind is not null))::text as ready,
              /* The same dishes, for the badge's one-tap Taken (D27-222). */
              array(select l.id::text from pos_order_lines l
                     where l.order_id = f.order_id and l.kot_status = 'ready'
                       and not l.voided
                       and (l.parent_line_id is null or l.extra_kind is not null)) as ready_ids
         from app.pos_floor($1) f
         left join lateral (select * from app.pos_joined_to(f.table_id) where f.state = 'blank') j on true`,
      [outlet[0].id],
    );

    /* Grouped here rather than in the browser: the SQL already returns
       them in section then row then column order, and re-sorting on the
       client is a second opinion about the same thing. */
    const sections: {
      id: string; name: string;
      tables: {
        id: string; label: string; seats: number | null;
        row: number; col: number;
        orderId: string | null; orderNo: string | null;
        state: string; minutes: number | null; payable: number | null;
        ready: number; readyIds: string[]; joinedTo?: string | null;
      }[];
    }[] = [];

    for (const r of rows) {
      let section = sections.find((s) => s.id === r.section_id);
      if (!section) {
        section = { id: r.section_id, name: r.section, tables: [] };
        sections.push(section);
      }
      section.tables.push({
        id: r.table_id, label: r.label, seats: r.seats,
        row: r.row_no, col: r.col_no,
        orderId: r.order_id, orderNo: r.order_no,
        /* blank · running · kot · printed · paid · closed (closed unpaid,
           207) · joined (D27-372). Derived, so the tile cannot disagree with
           the bill behind it. */
        state: r.state,
        ...(r.state === "joined" ? { joinedTo: r.joined_to } : {}),
        minutes: r.minutes,
        payable: r.payable === null ? null : Number(r.payable),
        ready: Number(r.ready),
        readyIds: r.ready_ids,
      });
    }

    /* THE OPEN PARCELS (the owner's D27-359): each by its customer, how long
       it has been open, what it comes to, and what the kitchen has ready. */
    const { rows: parcelRows } = await client.query<{
      id: string; order_no: string; name: string | null; phone: string | null;
      minutes: number; payable: string; ready: string; ready_ids: string[];
    }>(
      `select o.id::text, o.order_no, o.customer_name as name, o.customer_phone as phone,
              floor(extract(epoch from now() - o.opened_at) / 60)::int as minutes,
              (select t.payable from app.pos_order_total(o.id) t)::text as payable,
              (select coalesce(sum(l.qty), 0) from pos_order_lines l
                where l.order_id = o.id and l.kot_status = 'ready' and not l.voided
                  and (l.parent_line_id is null or l.extra_kind is not null))::text as ready,
              array(select l.id::text from pos_order_lines l
                     where l.order_id = o.id and l.kot_status = 'ready' and not l.voided
                       and (l.parent_line_id is null or l.extra_kind is not null)) as ready_ids
         from pos_orders o
        where o.outlet_id = $1 and o.order_type = 'takeaway' and o.status = 'open'
        order by o.opened_at`,
      [outlet[0].id],
    );

    return {
      outlet: {
        code, name: outlet[0].name,
        closedUntil: outlet[0].closed_until,
        closedReason: outlet[0].closed_reason,
      },
      sections,
      parcels: parcelRows.map((p) => ({
        orderId: p.id, orderNo: p.order_no, name: p.name ?? p.order_no, phone: p.phone,
        minutes: p.minutes, payable: Number(p.payable), ready: Number(p.ready), readyIds: p.ready_ids,
      })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

/* ── Printed, and cleared ─────────────────────────────────────────
   The two moments that make "printed" and "paid" different colours.
   Neither is a state somebody sets by hand on the tile: printing marks
   the order, and clearing the table is what a waiter does when the
   guests have gone. */

till.post("/:code/till/orders/:id/printed", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The FIRST print is what the colour means — the guest has the bill
       in front of them. Reprinting because the paper jammed does not
       restart that, so the timestamp is only set once. */
    const { rowCount } = await client.query(
      `update pos_orders set printed_at = coalesce(printed_at, now())
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such order.");
    return { ok: true as const, ...(await readOrder(client, c.req.param("id")))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* A TABLE IS FREE OR IT IS NOT (POS-33): clearing a finished bill frees its
   table of every finished bill on it opened no later - Clear, and a paid
   bill voided (D27-324). $1 is the order. */
const CLEAR_FINISHED =
  `update pos_orders set cleared_at = now()
    where cleared_at is null and status <> 'open'
      and (id = $1
           or (table_id = (select table_id from pos_orders where id = $1)
               and opened_at <= (select opened_at from pos_orders where id = $1)))`;

till.post("/:code/till/orders/:id/clear", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows } = await client.query<{
      status: string; order_no: string; cleared_at: string | null;
    }>(
      `select status, order_no, cleared_at::text from pos_orders
        where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!rows[0]) return refuse("No such order.");
    if (rows[0].cleared_at) return refuse("That table is already clear.");

    /* AN OPEN BILL IS NOT A FREE TABLE. Clearing one would take a live
       order off the floor with money on it — the guests are still
       sitting there and nobody can see what they have had. */
    if (rows[0].status === "open") {
      return refuse(
        `${rows[0].order_no} has not been settled. Take payment, or close it ` +
        "unpaid with a reason.");
    }

    /* A TABLE IS FREE OR IT IS NOT (POS-33). Clearing frees it of every
       finished bill still on it, not only this one: a bill closed unpaid
       under a later one, typed for the same table, otherwise came back as
       the table's own the moment the later one was cleared - old amount and
       all. Only finished ones; an open bill is refused above, and one on
       no table is only itself. */
    /* No NEWER bill than the one pressed (the audit of 9 October): a tablet
       showing an old tile must not clear a bill settled after it, whose
       guests may still be seated. Older ones are what POS-33 is about. */
    await client.query(CLEAR_FINISHED, [orderId]);

    return { ok: true as const, orderNo: rows[0].order_no };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* ── The order header ─────────────────────────────────────────────
   Covers, waiter, customer and channel — the five icons above the bill.

   ONE endpoint, because they are one panel. Four endpoints would mean a
   waiter who fills the panel in and taps away produces four writes,
   three of which can fail on their own and leave the header half
   entered with nothing saying which half.

   Every field is OPTIONAL and only what is SENT is written. Sending
   `covers` must not blank the waiter somebody set a minute ago. */

till.patch("/:code/till/orders/:id", async (c) => {
  type HeaderBody = {
    covers?: number | null;
    waiterId?: string | null;
    orderType?: string;
    customerName?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
    customerLocality?: string | null;
    held?: boolean;
    /** The banquet function this order goes on (D17-21). Null takes it
        off; absent leaves it as it is. */
    eventId?: string | null;
  };
  const input = await c.req.json<HeaderBody>().catch(() => ({}) as HeaderBody);

  if (input.eventId !== undefined && input.eventId !== null
      && typeof input.eventId !== "string") {
    return c.json(refuse("Which function is this order for?"), 409);
  }

  const TYPES = ["dine_in", "takeaway", "room_service", "delivery"];
  if (input.orderType !== undefined && !TYPES.includes(input.orderType)) {
    return c.json(refuse("Dine in, parcel, room service or delivery."), 409);
  }
  /* A phone the kitchen cannot call and the guest search cannot find is
     not kept (QA X-2): the one rule, api/src/validate.ts. */
  const badPhone = phoneProblem(input.customerPhone);
  if (badPhone) return c.json(refuse(badPhone), 409);
  if (input.covers !== undefined && input.covers !== null
      && (!Number.isInteger(input.covers) || input.covers < 1)) {
    /* Zero covers is a table nobody is sitting at. Named here so the
       waiter is not shown a constraint violation for a typo. */
    return c.json(refuse("How many people are eating?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    /* ON A BANQUET FUNCTION'S BILL (D17-21). Which functions may take an
       order is the banquet service's rule, asked through its door — the
       same rule its list for this screen is drawn from, so the till never
       accepts a function the screen would not have offered. Asked BEFORE
       the write: inside withSession a refusal after it is a commit
       (MEMORY 243). Taking an order off a function needs no rule. */
    if (input.eventId) {
      const why = await whyNotAttachable(client, hotelId, input.eventId);
      if (why) return refuse(why);
    }

    /* Only what was sent. A patch that wrote every column would blank
       the waiter each time somebody changed the covers. */
    const sets: string[] = [];
    const args: unknown[] = [];
    const set = (col: string, value: unknown) => {
      args.push(value);
      sets.push(`${col} = $${args.length}`);
    };

    if (input.covers !== undefined) set("covers", input.covers);
    if (input.waiterId !== undefined) set("waiter_id", input.waiterId);
    if (input.orderType !== undefined) set("order_type", input.orderType);
    if (input.customerName !== undefined) {
      set("customer_name", input.customerName?.trim() || null);
    }
    if (input.customerPhone !== undefined) {
      set("customer_phone", input.customerPhone?.trim() || null);
    }
    if (input.customerAddress !== undefined) {
      set("customer_address", input.customerAddress?.trim() || null);
    }
    if (input.customerLocality !== undefined) {
      set("customer_locality", input.customerLocality?.trim() || null);
    }
    /* Parked. A table that has ordered drinks and is not ready for food
       should not be a bill a waiter has to remember. */
    if (input.held !== undefined) {
      sets.push(input.held ? "held_at = now()" : "held_at = null");
    }
    if (input.eventId !== undefined) set("event_id", input.eventId || null);

    if (!sets.length) return refuse("Nothing to change.");

    args.push(orderId, hotelId);
    try {
      await client.query(
        `update pos_orders set ${sets.join(", ")}, updated_at = now()
          where id = $${args.length - 1} and hotel_id = $${args.length}`,
        args,
      );
    } catch (error) {
      /* The waiter-scope trigger raises a sentence. Passing it through
         beats "internal error" for something the person can fix by
         picking a different name. */
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("does not work at this property")) {
        return refuse("That person does not work at this property.");
      }
      throw error;
    }

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* Who can be named as the waiter. Everyone with access to this property
   — the same answer housekeeping gives, and for the same reason: nobody
   holds a `waiter` role, and inventing one would leave the list empty on
   the first evening. */
till.get("/:code/till/waiters", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* From app.hotel_people (149, the owner's D27-97): read from `staff` and
       `staff_hotels` it was the caller alone for anyone who does not run the
       hotel - row security shows each person only their own roster line. */
    const { rows } = await client.query<{ id: string; name: string }>(
      `select id::text, full_name as name
         from app.hotel_people($1)
        where is_active
        order by full_name`,
      [hotelId],
    );
    return { waiters: rows };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});


/* ── Day end ──────────────────────────────────────────────────────
   Three steps: the overview, the cash count, and the close.

   THE SAME SHAPE AS THE NIGHT AUDIT, and not a second one. The hotel's
   audit refuses while something is wrong and NAMES it. A restaurant
   close has the same character — an open bill and an uncleared table
   are questions a person answers, not conditions a job can decide.

   A drawer that does not balance is NOT one of them. The money is
   already whatever it is, and a shift that cannot close is worse than
   a difference that is written down with a reason. */

till.get("/:code/till/day-end", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const outletCode = (c.req.query("outlet") ?? "REST").toUpperCase();
    const { rows: outlet } = await client.query<{ id: string; name: string }>(
      `select id::text, name from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, outletCode],
    );
    if (!outlet[0]) return null;

    /* The hotel's operating day, not the clock. A close started at 00:40
       is closing the evening that is still being served. */
    const businessDate = c.req.query("date")
      ?? await businessDateFor(client, hotelId);

    const { rows: summary } = await client.query<{
      settled_orders: number; settled_value: string;
      abandoned_orders: number; abandoned_value: string;
      comp_orders: number; discount_given: string;
      by_method: Record<string, string>;
    }>(
      `select settled_orders, settled_value::text, abandoned_orders,
              abandoned_value::text, comp_orders, discount_given::text,
              by_method
         from app.pos_day_summary($1, $2::date)`,
      [outlet[0].id, businessDate],
    );

    const { rows: blockers } = await client.query<{
      id: string; reason: string; detail: string | null;
    }>(
      `select id, reason, detail from app.pos_day_end_blockers($1, $2::date)`,
      [outlet[0].id, businessDate],
    );

    const { rows: movements } = await client.query<{
      id: string; kind: string; amount: string; reason: string;
      recorded_by_name: string | null; recorded_at: string;
      approval: string | null; approval_note: string | null;
      category: string | null; photo: boolean;
    }>(
      /* A LEFT join (D27-9): a name the reader may not see - the group
         owner's, to a GM (MEMORY 283) - is null, not the whole movement. */
      `select m.id::text, m.kind, m.amount::text, m.reason, m.category,
              exists (select 1 from attachments a where a.subject_table = 'pos_cash_movements'
                         and a.subject_id = m.id) as photo,
              s.full_name as recorded_by_name,
              app.hotel_clock(m.hotel_id, m.recorded_at, 'HH24:MI') as recorded_at,
              ${PAID_OUT_DECISION("status")} as approval,
              ${PAID_OUT_DECISION("decision_note")} as approval_note
         from pos_cash_movements m
         left join staff s on s.id = m.recorded_by
        where m.outlet_id = $1 and m.business_date = $2::date
        order by m.recorded_at`,
      [outlet[0].id, businessDate],
    );

    const { rows: day } = await client.query<{
      id: string; opening_cash: string; counted_cash: string | null;
      variance_reason: string | null; closed_at: string | null;
      closed_by_name: string | null;
    }>(
      `select d.id::text, d.opening_cash::text, d.counted_cash::text,
              d.variance_reason, app.hotel_clock(d.hotel_id, d.closed_at, 'DD Mon, HH24:MI') as closed_at,
              s.full_name as closed_by_name
         from pos_day_ends d
         left join staff s on s.id = d.closed_by
        where d.outlet_id = $1 and d.business_date = $2::date`,
      [outlet[0].id, businessDate],
    );

    const { rows: expected } = await client.query<{ amount: string }>(
      `select app.pos_expected_cash($1, $2::date)::text as amount`,
      [outlet[0].id, businessDate],
    );

    const struck = await struckAfterKitchen(client, hotelId, businessDate, outlet[0].id);
    const voided = await voidedBills(client, hotelId, businessDate, outlet[0].id);
    const noCharge = await noChargeBills(client, hotelId, businessDate, outlet[0].id);
    const modeChanges = await tenderChanges(client, hotelId, businessDate, outlet[0].id);

    const denominations = day[0]
      ? (await client.query<{ value: string; count: number }>(
          `select value::text, count from pos_denominations
            where day_end_id = $1 order by value desc`, [day[0].id])).rows
      : [];

    const counted = day[0]?.counted_cash;
    const expectedCash = Number(expected[0]!.amount);
    const opening = await openingCash(client, outlet[0].id, businessDate);
    const waiting = await paidOutsWaiting(client, outlet[0].id, businessDate);

    return {
      outlet: { code: outletCode, name: outlet[0].name },
      businessDate,
      summary: {
        settledOrders: summary[0]!.settled_orders,
        settledValue: Number(summary[0]!.settled_value),
        abandonedOrders: summary[0]!.abandoned_orders,
        abandonedValue: Number(summary[0]!.abandoned_value),
        compOrders: summary[0]!.comp_orders,
        discountGiven: Number(summary[0]!.discount_given),
        byMethod: Object.fromEntries(
          Object.entries(summary[0]!.by_method ?? {})
            .map(([k, v]) => [k, Number(v)])),
      },
      /* What a PERSON must decide before this can close. */
      blockers,
      /* Food struck after the kitchen had it, and why (D27-119). */
      struck,
      /* Paid bills voided (D27-324): left out of `summary`; their cash is
         still in the tin and in `cash.expected`. */
      voided,
      /* Bills given free, NC (D27-351): who, when and why, no value. */
      noCharge,
      /* Paid bills whose payment mode was changed (D27-363), and whether
         after the drawer was counted. */
      modeChanges,
      movements: movements.map((m) => ({
        id: m.id, kind: m.kind, amount: Number(m.amount),
        reason: m.reason, recordedBy: m.recorded_by_name, at: m.recorded_at,
        /* A paid-out's yes (D27-242); null where nobody was asked. */
        approval: m.approval, approvalNote: m.approval_note,
        /* The petty cash book (D27-370): null on one from before it. */
        category: m.category, photo: m.photo,
      })),
      cash: {
        opening: opening ?? 0,
        expected: expectedCash,
        /* Paid-outs waiting for a yes: not in Expected yet (D27-242). */
        waiting,
        counted: counted === null || counted === undefined ? null : Number(counted),
        /* The one figure anybody argues about, worked out in one place
           and shown BEFORE the close rather than discovered after it. */
        variance: counted === null || counted === undefined
          ? null : Number(counted) - expectedCash,
        varianceReason: day[0]?.variance_reason ?? null,
        denominations: denominations.map((d) => ({
          value: Number(d.value), count: d.count,
        })),
      },
      /* False only on the outlet's first-ever day, before its one count (D27-200). */
      opened: opening !== null,
      closedAt: day[0]?.closed_at ?? null,
      closedBy: day[0]?.closed_by_name ?? null,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* Open the day: an outlet's FIRST-EVER float, counted once (D27-200). Every
   day after opens by itself on the float the last close kept, and this is
   refused. */
till.post("/:code/till/day-end/open", async (c) => {
  type OpenBody = { outlet?: string; opening?: unknown };
  const input = await c.req.json<OpenBody>().catch(() => ({}) as OpenBody);
  const opening = input.opening;
  if (typeof opening !== "number" || !Number.isFinite(opening) || opening < 0) {
    return c.json(refuse(
      "Count the opening float first - enter 0 if the tin is empty."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: outlet } = await client.query<{ id: string }>(
      `select id::text from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, (input.outlet ?? "REST").toUpperCase()],
    );
    if (!outlet[0]) return refuse("No such outlet.");

    const businessDate = await businessDateFor(client, hotelId);
    const carried = await openingCash(client, outlet[0].id, businessDate);
    if (carried !== null) {
      return refuse(`Today is already open, on a float of ₹${carried.toFixed(2)}. There is nothing to count in.`);
    }
    const { rows } = await client.query(
      `insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash)
       values ($1,$2,$3,$4)
       on conflict (outlet_id, business_date) do nothing
       returning id`,
      [hotelId, outlet[0].id, businessDate, opening.toFixed(2)],
    );
    if (!rows.length) return refuse("Today is already open. Its float was counted.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/day-end/movements", async (c) => {
  type MoveBody = {
    outlet?: string; kind?: string; amount?: number; reason?: string; category?: string;
  };
  const input = await c.req.json<MoveBody>().catch(() => ({}) as MoveBody);

  const KINDS = ["expense", "top_up", "withdrawal", "due_collection"];
  if (!input.kind || !KINDS.includes(input.kind)) {
    return c.json(refuse("Money out, money in, to the safe, or a due paid?"), 409);
  }
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
    return c.json(refuse("How much?"), 409);
  }
  /* ALWAYS. An unexplained hundred rupees out of a till is the thing a
     day end exists to surface, and "misc" is what people type when the
     field is optional. */
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse("What was it for? This is the line somebody asks about."), 409);
  }
  /* The petty cash book's category (D27-370): one of five, on a paid-out. */
  const noCategory = categoryProblem(input.kind, input.category);
  if (noCategory) return c.json(refuse(noCategory), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: outlet } = await client.query<{ id: string; name: string }>(
      `select id::text, name from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, (input.outlet ?? "REST").toUpperCase()],
    );
    if (!outlet[0]) return refuse("No such outlet.");

    const businessDate = await businessDateFor(client, hotelId);

    const { rows: closed } = await client.query<{ closed_at: string | null }>(
      `select closed_at::text from pos_day_ends
        where outlet_id = $1 and business_date = $2::date`,
      [outlet[0].id, businessDate],
    );
    if (closed[0]?.closed_at) {
      /* A correction is a movement on TODAY, not an edit of yesterday. */
      return refuse(
        "That day is closed. Record it against today instead.");
    }

    const { rows: made } = await client.query<{ id: string }>(
      `insert into pos_cash_movements
         (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by, category)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id::text`,
      [hotelId, outlet[0].id, businessDate, input.kind,
       Number(input.amount).toFixed(2), reason, session.staffId,
       input.kind === "expense" ? input.category : null],
    );
    /* A paid-out waits for the GM's or the owner's yes (D27-242); it counts
       in the tin only once given (app.cash_expense_counts, 189). */
    if (input.kind === "expense") {
      await client.query(
        `select app.request_approval($1::uuid, 'cash_expense', 'pos_cash_movements',
                $2::uuid, $3, $4, $5::uuid)`,
        [hotelId, made[0]!.id, `${outlet[0].name} tin: ${reason}`,
         Number(input.amount).toFixed(2), session.staffId]);
    }

    /* Its id, for the photo of the bill that may follow (D27-370). */
    return { ok: true as const, id: made[0]!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* A paid-out's photo of its bill (D27-370), when recorded or afterwards - a
   closed day's too: the photo changes no figure. Finance's door, wrapped. */
till.post("/:code/till/day-end/movements/:id/photo", (c) => putExpensePhoto(c, "pos_cash_movements"));
till.get("/:code/till/day-end/movements/:id/photo", (c) => serveExpensePhoto(c, "pos_cash_movements"));

till.post("/:code/till/day-end/count", async (c) => {
  type CountBody = {
    outlet?: string;
    denominations?: { value: number; count: number }[];
  };
  const input = await c.req.json<CountBody>().catch(() => ({}) as CountBody);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: outlet } = await client.query<{ id: string }>(
      `select id::text from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, (input.outlet ?? "REST").toUpperCase()],
    );
    if (!outlet[0]) return refuse("No such outlet.");

    const businessDate = await businessDateFor(client, hotelId);

    /* The day opened by itself on the float the last close kept (D27-200);
       the count writes that down as the day's row. Never a typed or a
       default float - on the outlet's first-ever day it is counted first. */
    const carried = await openingCash(client, outlet[0].id, businessDate);
    if (carried === null) {
      return refuse("Open the day first: this outlet's first float is counted once.");
    }
    await client.query(
      `insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash)
       values ($1,$2,$3,$4)
       on conflict (outlet_id, business_date) do nothing`,
      [hotelId, outlet[0].id, businessDate, carried.toFixed(2)],
    );
    const { rows: day } = await client.query<{ id: string; closed_at: string | null }>(
      `select id::text, closed_at::text from pos_day_ends
        where outlet_id = $1 and business_date = $2::date`,
      [outlet[0].id, businessDate],
    );
    if (!day[0]) return refuse("Open the day first: this outlet's first float is counted once.");
    if (day[0].closed_at) return refuse("That day is already closed.");
    const dayId = day[0].id;

    if (input.denominations) {
      /* Replaced wholesale. A count is one act — somebody empties the tin
         and counts it — and merging a new count into an old one leaves
         denominations nobody typed this time. */
      await client.query(
        `delete from pos_denominations where day_end_id = $1`, [dayId]);
      for (const d of input.denominations) {
        if (!Number.isFinite(d.value) || d.value <= 0) continue;
        if (!Number.isInteger(d.count) || d.count < 0) continue;
        if (d.count === 0) continue;
        await client.query(
          `insert into pos_denominations (day_end_id, value, count)
           values ($1,$2,$3)`, [dayId, d.value, d.count]);
      }

      const { rows: total } = await client.query<{ total: string }>(
        `select coalesce(sum(value * count), 0)::text as total
           from pos_denominations where day_end_id = $1`, [dayId]);
      await client.query(
        `update pos_day_ends set counted_cash = $1 where id = $2`,
        [total[0]!.total, dayId]);
    }

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/day-end/close", async (c) => {
  type CloseBody = { outlet?: string; varianceReason?: string; keptCash?: unknown };
  const input = await c.req.json<CloseBody>().catch(() => ({}) as CloseBody);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: outlet } = await client.query<{ id: string }>(
      `select id::text from pos_outlets
        where hotel_id = $1 and code = $2 and is_active`,
      [hotelId, (input.outlet ?? "REST").toUpperCase()],
    );
    if (!outlet[0]) return refuse("No such outlet.");

    const businessDate = await businessDateFor(client, hotelId);

    /* The night audit's rule. Only what a person must decide, and the
       refusal names it. */
    const { rows: blockers } = await client.query<{ reason: string }>(
      `select reason from app.pos_day_end_blockers($1, $2::date)`,
      [outlet[0].id, businessDate],
    );
    if (blockers.length) {
      return { ok: false as const, reason: blockers.map((b) => b.reason).join(" "),
               blockers };
    }

    const { rows: day } = await client.query<{
      id: string; counted_cash: string | null; closed_at: string | null;
    }>(
      `select id::text, counted_cash::text, closed_at::text from pos_day_ends
        where outlet_id = $1 and business_date = $2::date`,
      [outlet[0].id, businessDate],
    );
    if (!day[0]) return refuse("Count the drawer first.");
    if (day[0].closed_at) return refuse("That day is already closed.");
    if (day[0].counted_cash === null) return refuse("Count the drawer first.");

    const { rows: expected } = await client.query<{ amount: string }>(
      `select app.pos_expected_cash($1, $2::date)::text as amount`,
      [outlet[0].id, businessDate],
    );
    const variance =
      Number(day[0].counted_cash) - Number(expected[0]!.amount);
    /* Paid-outs waiting for a yes explain that much of a shortage
       (D27-242): a reason is asked only for the rest. */
    const waiting = await paidOutsWaiting(client, outlet[0].id, businessDate);
    const unexplained = variance + waiting;

    /* A difference is RECORDED, not refused — but it must say why. The
       money is already whatever it is; what a manager needs tomorrow is
       the sentence, not the number on its own. */
    if (Math.abs(unexplained) >= 0.01 && !input.varianceReason?.trim()) {
      return refuse(
        `The drawer is ${unexplained > 0 ? "over" : "short"} by ` +
        `₹${Math.abs(unexplained).toFixed(2)}` +
        (waiting > 0 ? ", beyond the paid-outs waiting for a yes" : "") +
        ". Say why, and it closes.");
    }

    /* THE FLOAT KEPT (D27-191): typed at every close; the rest of the count
       is cash to deposit. */
    const counted = Number(day[0].counted_cash);
    const kept = input.keptCash;
    if (typeof kept !== "number" || !Number.isFinite(kept) || kept < 0 || kept > counted) {
      return refuse(
        `Say what float is kept for the next day - from ₹0 to the ₹${counted.toFixed(2)} counted.`);
    }

    await client.query(
      `update pos_day_ends
          set variance_reason = $1, closed_by = $2, closed_at = now(), kept_cash = $4
        where id = $3`,
      [input.varianceReason?.trim() || null, session.staffId, day[0].id, kept.toFixed(2)],
    );

    return {
      ok: true as const, businessDate, variance,
      counted: Number(day[0].counted_cash),
      expected: Number(expected[0]!.amount),
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Settling ─────────────────────────────────────────────────────── */

till.post("/:code/till/orders/:id/settle", async (c) => {
  type Tender = {
    method?: string; amount?: number; tendered?: number; reference?: string;
  };
  type SettleBody = {
    method?: string; room?: string; folioId?: string; tenders?: Tender[];
    /* D27-366: method "allowance" - how the part above the free amount is paid. */
    rest?: { method?: string; tendered?: number; reference?: string };
    /* D25-40: asked when more than ₹1,00,000 of the bill is cash. */
    pan?: string; form97?: boolean; nonResident?: boolean;
  };
  const input = await c.req.json<SettleBody>().catch(() => ({}) as SettleBody);

  const METHODS = ["room", "cash", "card", "upi"];

  /* A FUNCTION IS NOT A WAY TO PAY PART OF A BILL (D17-21). An order on a
     banquet function goes onto the function's bill whole — the host pays
     it there — so 'function' is never one tender among several. */
  if (Array.isArray(input.tenders)
      && input.tenders.some((t) => t?.method === "function")) {
    return c.json(refuse(
      "A bill on a function goes to the function in full. Settle it to the "
      + "function, or take it off the function and split it."), 409);
  }

  /* Two shapes reach here. `method` alone is the ordinary bill: one way,
     the whole amount. `tenders` is the Part button — several payments that
     must add up. Both end as rows in pos_order_tenders, so the drawer
     reconciles the same way regardless of which was used. */
  const raw = Array.isArray(input.tenders) ? input.tenders : null;
  let tenders: {
    method: string; amount: number;
    tendered: number | null; reference: string | null;
  }[] | null = null;

  if (raw) {
    if (raw.length === 0) {
      return c.json(refuse("Add at least one payment."), 409);
    }
    for (const t of raw) {
      if (!t.method || !METHODS.includes(t.method)) {
        return c.json(refuse("Each payment is room, cash, card or upi."), 409);
      }
      if (!Number.isFinite(Number(t.amount)) || Number(t.amount) <= 0) {
        return c.json(refuse("Every payment needs an amount above zero."), 409);
      }
      if (t.tendered !== undefined && t.method !== "cash") {
        return c.json(
          refuse("Only cash is tendered - a card pays its own amount."), 409);
      }
      if (t.tendered !== undefined && Number(t.tendered) < Number(t.amount)) {
        return c.json(
          refuse("The cash handed over is less than the amount being taken."),
          409);
      }
    }
    tenders = raw.map((t) => ({
      method: t.method!,
      amount: Number(t.amount),
      tendered: t.tendered === undefined ? null : Number(t.tendered),
      reference: t.reference?.trim() || null,
    }));

    /* A room charge reaches the folio as one posting per tax rate. Paying
       PART of a bill to a room would mean apportioning that part across
       rates again, and there is no defensible way to choose which rate a
       partial payment settles. Refused with a reason rather than guessed. */
    if (tenders.some((t) => t.method === "room") && tenders.length > 1) {
      return c.json(refuse(
        "A bill going to a room has to go there in full. Split it between " +
        "cash, card and UPI, or charge the whole bill to the room."), 409);
    }
  }

  let method = tenders
    ? (tenders.length === 1 ? tenders[0]!.method : "split")
    : input.method;

  if (!method
      || !(METHODS.includes(method) || method === "split" || method === "function" || method === "allowance")) {
    return c.json(refuse("How was this paid - room, cash, card or upi?"), 409);
  }
  /* THE OWNER'S ALLOWANCE (D27-355, D27-366): the free part is worked out here,
     on the server, never sent; the rest is paid by cash, card or UPI, asked
     always, because a bill can come to more than is left by the time it is settled. */
  const rest = input.rest;
  if (method === "allowance") {
    if (!rest?.method || !["cash", "card", "upi"].includes(rest.method)) {
      return c.json(refuse("How is the rest paid, above the free amount - cash, card or UPI?"), 409);
    }
    if (rest.tendered !== undefined && rest.method !== "cash") {
      return c.json(refuse("Only cash is tendered - a card pays its own amount."), 409);
    }
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    /* ⚠ LOCKED, so two Settle presses cannot both take the money. Without
       it both read "open", both wrote their payments, and a room press
       beside a cash press charged the folio AND the drawer (28 September,
       the release review). The second press now waits here, reads
       "settled", and is refused before anything is written - both
       branches below sit behind this one line. */
    const { rows: order } = await client.query<{
      status: string; order_no: string; outlet_id: string;
      business_date: string; outlet_name: string; category: string;
      order_type: string; customer_phone: string | null;
      event_id: string | null; event_title: string | null;
    }>(
      `select o.status, o.order_no, o.outlet_id::text,
              to_char(o.business_date,'YYYY-MM-DD') as business_date,
              ou.name as outlet_name, ou.category,
              o.order_type, o.customer_phone,
              o.event_id::text, e.title as event_title
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
         left join banquet_events e on e.id = o.event_id
        where o.id = $1 and o.hotel_id = $2
          for update of o`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is already ${order[0].status}.`);
    }
    if (await dayClosed(client, order[0].outlet_id, order[0].business_date)) {
      return refuse(DAY_CLOSED);
    }

    /* ON A FUNCTION'S BILL, PAID THERE AND NOWHERE ELSE — the owner's
       answer of 17 September (D17-21). The function's bill already counts
       every settled order on it (app.banquet_event_total, 061), so cash
       taken here as well would bill the host for food already paid for. */
    const onFunction = order[0].event_id;
    if (onFunction && method !== "function") {
      return refuse(
        `This order is on ${order[0].event_title ?? "a function"}'s bill. `
        + "Settle it to the function, or take it off the function first.");
    }
    if (method === "function") {
      if (!onFunction) {
        return refuse("This order is not on a function. Choose the function first.");
      }
      /* Asked again at the settle, not only when it was attached: a
         function can be cancelled, or its bill closed, while dinner is
         being eaten. */
      const why = await whyNotAttachable(client, hotelId, onFunction);
      if (why) return refuse(why);
    }

    /* YOU CANNOT DELIVER TO NOBODY, and the database says so at
       settlement. Reached here first so the biller gets a sentence they
       can act on instead of a 500 — the constraint is the guarantee, and
       this is the reason.

       Caught by its own test, which expected a refusal and got an
       internal error. */
    if (order[0].order_type === "delivery" && !order[0].customer_phone) {
      return refuse(
        "This is a delivery with no phone number. It will be cooked and " +
        "then it cannot leave the building - take a number first.");
    }
    /* THE OWNER'S ALLOWANCE: its % off goes on behind a savepoint, so the totals
       below are the discounted bill; every refusal after this undoes it first,
       because a refusal returned here is still a COMMIT (MEMORY 243). */
    let allowance: AllowancePlan | null = null;
    const undo = async () => { if (allowance) await client.query("rollback to savepoint allowance"); };
    if (method === "allowance") {
      if (!(await maySettleAllowance(client, hotelId))) return refuse(SETTLE_REFUSED);
      const plan = await allowancePlan(client, hotelId, orderId);
      if (!plan.ok) return plan;
      allowance = plan;
      await client.query("savepoint allowance");
      await setDiscount(client, orderId, plan.discountNet, plan.reason);
    }
    if ((tenders ? tenders.some((t) => t.method === "cash") : method === "cash" || rest?.method === "cash")
        && (await openingCash(client, order[0].outlet_id, order[0].business_date)) === null) {
      await undo();
      return refuse(
        "Count this outlet's first float once (Close restaurant day, Open the day): cash is "
        + "taken after it. From then on the day opens by itself. Card, UPI and room charges go on.");
    }

    const { rows: t } = await client.query<{
      net: string; discount: string; tax: string;
      gross: string; payable: string;
    }>(`select net::text, discount::text, tax::text, gross::text,
               payable::text from app.pos_order_total($1)`,
      [orderId]);

    const net = Number(t[0]!.net);
    /* CASH IS WHOLE RUPEES (QA NA-2, the owner's answer of 28 September).
       The till shows ₹1,097 and the guest hands over ₹1,097; the payment
       used to be written as ₹1,097.20, and the drawer then expected paise
       nobody took ("Over by ₹0.30" on an exact count). A bill paid wholly
       in cash is rounded to the rupee here, as the Round off button does by
       hand, and says so on its Round off line. Card, UPI and a room charge
       stay exact to the paisa. Written with the settle, after every
       refusal below (MEMORY 243). */
    const allCash = tenders ? tenders.every((x) => x.method === "cash") : method === "cash";
    /* AUTOMATIC ROUND-OFF (192, the owner's D27-260 Q4): every bill paid at
       the restaurant to the rupee; one charged to a room or a function stays
       exact, as room bills and invoices do. */
    const autoRound = method !== "room" && method !== "function" && (await client.query<{ r: string }>(
      "select pos_round_off as r from hotels where id = $1", [hotelId])).rows[0]?.r === "automatic";
    const gross = Number(t[0]!.gross);
    const cashRoundOff = allCash || autoRound ? (Math.round(gross) - gross).toFixed(2) : null;
    const payable = allCash || autoRound ? Math.round(gross) : Number(t[0]!.payable);

    /* An empty bill is not a sale. Settling one would put a zero-value
       ticket on a folio and a zero row in the shift count, which is
       noise somebody has to explain later. */
    if (net <= 0) {
      await undo();
      return refuse(
        "There is nothing on this order. Add an item, or abandon it.",
      );
    }

    /* The allowance pays what it can of the bill as it now stands (rounded, as any
       bill here is); the rest, after its % off, is the cash, card or UPI asked for. */
    if (allowance) {
      const free = Math.min(allowance.left, payable);
      const owed = Math.round((payable - free) * 100) / 100;
      tenders = [
        ...(free > 0 ? [{ method: "allowance", amount: free, tendered: null, reference: null }] : []),
        ...(owed > 0 ? [{ method: rest!.method!, amount: owed,
                          tendered: rest!.tendered === undefined ? null : Number(rest!.tendered),
                          reference: rest!.reference?.trim() || null }] : []),
      ];
      method = tenders.length === 1 ? tenders[0]!.method : "split";
    }

    /* The tenders must equal the bill exactly. Short is a drawer that will
       not reconcile at day end; over is change that was never given. */
    if (tenders) {
      const taken = tenders.reduce((a, t) => a + t.amount, 0);
      if (Math.abs(taken - payable) > 0.005) {
        return refuse(
          `The payments come to ₹${taken.toFixed(2)} and the bill is ` +
          `₹${payable.toFixed(2)}.`,
        );
      }
    }

    /* Everything comped. There is no payment to record, and a tender row
       must carry a positive amount, so the bill settles with none. */
    const rows = payable <= 0
      ? []
      : tenders ?? [{
          method: method === "split" ? "cash" : method,
          amount: payable, tendered: null, reference: null,
        }];

    /* D25-40: cash on one bill - refused at ₹2,00,000, and a PAN, Form 97 or
       a guest from abroad above ₹1,00,000. Asked before anything is written. */
    const cash = rows.filter((t) => t.method === "cash").reduce((a, t) => a + t.amount, 0);
    const over = overCashLimit(0, cash, "card or UPI, or charge the bill to the room");
    if (over) { await undo(); return refuse(over); }
    const kept = panFor(cash, { pan: input.pan, form97: input.form97, foreign: input.nonResident === true });
    if (!kept.ok) { await undo(); return { ok: false as const, reason: kept.reason, needs: "pan" as const }; }

    const writeTenders = async () => {
      for (const t of rows) {
        await client.query(
          `insert into pos_order_tenders
             (order_id, hotel_id, method, amount, tendered, reference, taken_by)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [orderId, hotelId, t.method, t.amount.toFixed(2),
           t.tendered === null ? null : t.tendered.toFixed(2),
           t.reference, session.staffId],
        );
      }
    };

    /* ── Cash, card, upi: nothing touches a folio ─────────────────── */
    if (method !== "room" && method !== "function") {
      await client.query(
        `update pos_orders
            set status='settled', settled_by=$1, settled_at=now(),
                payment_method=$2, pan=$4, form_97=$5, non_resident=$6,
                round_off = coalesce($7::numeric, round_off),
                on_owner_allowance = $8
          where id = $3`,
        [session.staffId, method, orderId, kept.pan, kept.form97, kept.nonResident,
         cashRoundOff, allowance !== null],
      );
      await writeTenders();
      /* D22-44: paid here, so its alcohol gets its VAT bill now, in this
         transaction (none when there is no VAT on it). */
      await client.query("select app.issue_vat_bill(null, $1)", [orderId]);
      return { ok: true as const, ...(await readOrder(client, orderId))! };
    }

    /* ── To a function: onto its bill, the way a room is charged ────
       The owner's D27-133 (28 September): an order settled to a function
       reaches the function's folio as the room branch below posts it -
       one line per tax rate, with the till's own tax - so it is on the
       function's tax invoice and the day book counts it once, from the
       folio (reports' posSales leaves 'function' out, as it does 'room').
       whyNotAttachable above has already said the bill is open. */
    let target: { folio_id: string; guest_name: string } | undefined;
    let room: string | undefined;
    if (method === "function") {
      const { rows: bill } = await client.query<{ folio_id: string; guest_name: string }>(
        `select id::text as folio_id, $2::text as guest_name from folios
          where event_id = $1 and status = 'open'`,
        [onFunction, order[0].event_title]);
      target = bill[0];
      if (!target) return refuse(`The bill for ${order[0].event_title ?? "this function"} is closed.`);
    } else {

      /* ── To a room: through the bridge, not around it ────────────── */
      /* Rooms are saved in capitals (D27-335), so 111a finds 111A (D27-336). */
      room = input.room?.trim().toUpperCase();
      if (!room) return refuse("Which room is this bill for?");

      const { rows: chargeable } = await client.query<{
        folio_id: string; guest_name: string; company: string | null;
      }>(
        `select c.folio_id::text, c.guest_name, ${BILL_COMPANY}
           from app.pos_chargeable_rooms($1) c ${BILL_JOIN}
          where c.room_number = $2`,
        [hotelId, room],
      );

      /* ONE ROOM, TWO GUESTS. A same-day changeover leaves both folios
         open. The bridge refuses and names both rather than charging
         whoever the database returned first; the till must do the same,
         and here it can actually ask the person standing at it. */
      const candidates = input.folioId
        ? chargeable.filter((r) => r.folio_id === input.folioId)
        : chargeable;

      if (candidates.length > 1) {
        return {
          ok: false as const,
          reason:
            `Room ${room} has ${candidates.length} open folios - a changeover ` +
            `day. Choose the guest who ate.`,
          choices: candidates.map((r) => ({
            folioId: r.folio_id, guest: r.guest_name, company: r.company,
          })),
        };
      }

      target = candidates[0];
      if (!target) {
        return refuse(
          `Room ${room} cannot be charged: nobody is checked in there, or the ` +
            `folio is closed. Take payment another way.`,
        );
      }
    }

    const businessDate = await businessDateFor(client, hotelId);

    /* ── ONE POSTING PER TAX RATE ─────────────────────────────────
       The ledger refuses anything else. `fp_tax_consistent` (015)
       requires tax_amount = round(amount * tax_rate / 100, 2) within
       a paisa, and a folio posting carries ONE rate — so a bill of
       5% food and 18% water cannot be a single row. A blended rate
       does not rescue it: 680 at an effective 5.76% computes to
       39.17 against an actual 39.20, which is three paise outside
       the tolerance.

       That constraint is right and GST agrees with it. Two rates are
       two taxable supplies, and the Sales Register reports them
       separately. The first version of this posted one row with
       tax_rate 0 and the tax in tax_amount; the database rejected it
       immediately, which is the constraint doing its job. */
    /* app.pos_order_by_rate (now app.pos_order_by_tax, which it is built
       from), NOT a second copy of the arithmetic here.
       This query used to compute the split itself from the lines, which was
       correct until discounts existed and silently wrong afterwards: the
       guest holds a discounted bill and the folio receives the full amount.
       Nobody notices at the till, because the till's own total is right.

       `taxable` is the discounted net — what the folio must actually be
       charged. */
    /* BY TAX AS WELL AS BY RATE (D21-91): alcohol reaches the folio as its
       own VAT posting, so the bill can print it as one "VAT 10%" line and
       the GST invoice and register can leave it out. */
    const { rows: byRate } = await client.query<{
      tax_scheme: "gst" | "vat"; tax_rate: string; net: string; tax: string;
    }>(
      `select tax_scheme, tax_rate::text, taxable::text as net, tax::text
         from app.pos_order_by_tax($1)
        where taxable > 0
        order by tax_rate, tax_scheme`,
      [orderId],
    );

    const split = byRate.length > 1;
    const tickets: string[] = [];

    for (const group of byRate) {
      const rate = Number(group.tax_rate);
      const groupNet = Number(group.net);
      const groupTax = Number(group.tax);
      const vat = group.tax_scheme === "vat";

      /* The ticket id is generated before either insert so the posting
         can name the ticket in one pass. The obvious shape — post,
         then update the posting with its source — is refused by the
         ledger, which grants pms_app no UPDATE on folio_postings. */
      const ticketId = randomUUID();

      /* A guest reading their folio should be able to tell why one
         restaurant bill became two lines. */
      const description = split
        ? `${order[0].outlet_name} - ${order[0].order_no} (${vat ? "VAT " : ""}${rate}%)`
        : `${order[0].outlet_name} - ${order[0].order_no}`;

      const { rows: posted } = await client.query<{ id: string }>(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, tax_scheme, source_type, source_id,
            posted_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$11,'pos',$9,$10)
         returning id::text`,
        [hotelId, target.folio_id, businessDate, order[0].category,
         description, groupNet, rate, groupTax, ticketId, session.staffId,
         group.tax_scheme],
      );

      /* The order number is the idempotency key, exactly as an outside
         POS's bill number is. A split bill suffixes the rate so both
         halves can live under `unique (outlet_id, ticket_ref)` - and VAT
         says so, or a VAT and a GST group at one rate would collide. */
      const ticketRef = split
        ? `${order[0].order_no}/${vat ? "VAT" : ""}${rate}`
        : order[0].order_no;

      await client.query(
        `insert into pos_tickets (id, hotel_id, outlet_id, ticket_ref, folio_id,
                                  posting_id, business_date, amount, tax_rate,
                                  tax_amount, status)
         values ($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10,'posted')`,
        [ticketId, hotelId, order[0].outlet_id, ticketRef, target.folio_id,
         posted[0]!.id, businessDate, groupNet, rate, groupTax],
      );

      tickets.push(ticketId);
    }

    await client.query(
      `update pos_orders
          set status='settled', settled_by=$1, settled_at=now(),
              payment_method=$4, ticket_id=$2
        where id = $3`,
      /* The first ticket, when a bill split across rates. The order is
         the record of the whole sale; pos_tickets is the record of what
         reached the folio, and a split bill reached it twice. */
      [session.staffId, tickets[0], orderId, method],
    );

    /* After the ticket exists. The room-tender trigger is deferred so the
       order would not matter, but writing it in the order a person would
       read is worth more than relying on that. */
    await writeTenders();

    return {
      ok: true as const,
      guest: target.guest_name,
      ...(room ? { room } : {}),
      ...(await readOrder(client, orderId))!,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/abandon", async (c) => {
  type AbandonBody = { reason?: string };
  const input = await c.req.json<AbandonBody>().catch(() => ({}) as AbandonBody);
  const reason = input.reason?.trim();

  /* A refusal says why, and so does an abandonment. An order closed
     with no explanation is the row nobody can account for at the end
     of a shift. */
  if (!reason) {
    return c.json(refuse("Why is this order being closed unpaid?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    /* Food the kitchen already has goes with the bill: the same people
       as striking it (D27-119, the owner's answer of 28 September). */
    const { rows: sent } = await client.query<{ n: number }>(
      `select count(*)::int as n from pos_order_lines
        where order_id = $1 and hotel_id = $2 and not voided
          and kot_status <> 'pending'`,
      [orderId, hotelId],
    );
    if (sent[0]!.n > 0) {
      const why = await sentStrikeRefusal(client, session, hotelId, reason);
      if (why) return refuse(why);
    }

    /* Who and when, from now on (D27-372): the Voids report prints them. */
    const { rowCount } = await client.query(
      `update pos_orders
          set status='abandoned', abandoned_reason=$1, abandoned_by=$4, abandoned_at=now()
        where id = $2 and hotel_id = $3 and status = 'open'`,
      [reason, orderId, hotelId, session.staffId],
    );
    if (!rowCount) return refuse("That order is not open.");

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── VOIDING A PAID BILL (the owner's D27-324 (1), 14 October) ────────
   The owner, an administrator or the GM (roleGate VOID_PAID_BILL, and the
   database's app.voids_paid_pos_bills behind it) voids a PAID bill, with a
   reason. The same business day only, before the outlet's day is closed;
   never a bill that went to a room or a function - it reached a folio and
   is reversed there. A card or UPI bill names the refund's reference. The
   bill keeps its number, its lines (the kitchen made the food) and its
   payments; it reprints VOID. Its cash goes back to the guest out of the
   RESTAURANT'S TIN, where the notes still are the same day (the owner's
   D27-327): the tin's Expected counts paid bills' cash only, so nothing is
   written for it, and nobody's front-desk drawer is touched. Its alcohol's
   VAT bill is cancelled in the same transaction (migration 222's trigger).
   Every refusal comes before the one write (MEMORY 243). */
/** A paid bill voided - by the owner, an Admin or the GM at the till, or by
    one of them approving a request (D27-363), as `session`. */
export async function voidBill(
  client: Client, session: Session, hotelId: string, orderId: string, reason: string, reference: string | null,
): Promise<Act> {
    /* Locked, as a settle is: two presses void it once. */
    const { rows: [o] } = await client.query<{
      status: string; payment_method: string | null; outlet_id: string;
      business_date: string; room: string | null; event_title: string | null;
    }>(
      `select o.status, o.payment_method, o.outlet_id::text,
              to_char(o.business_date, 'YYYY-MM-DD') as business_date,
              (select app.stay_room(f.reservation_id) from pos_tickets t
                 join folios f on f.id = t.folio_id where t.id = o.ticket_id) as room,
              (select e.title from banquet_events e where e.id = o.event_id) as event_title
         from pos_orders o
        where o.id = $1 and o.hotel_id = $2
          for update of o`,
      [orderId, hotelId],
    );
    if (!o) return refuse("No such order.");
    if (o.status === "void") return refuse("This bill is already void.");
    if (o.status === "open") return refuse("This bill is not paid. Close it unpaid instead, with a reason.");
    if (o.status !== "settled") return refuse("This bill was closed unpaid. There is nothing to void.");
    if (o.payment_method === "room") {
      return refuse(o.room
        ? `This bill went to room ${o.room} - reverse it on the guest's bill.`
        : "This bill went to a guest's room bill - reverse it on the guest's bill.");
    }
    if (o.payment_method === "function") {
      return refuse(`This bill went to ${o.event_title ?? "the function"}'s bill - reverse it on the function's bill.`);
    }
    const businessDate = await businessDateFor(client, hotelId);
    if (o.business_date !== businessDate) {
      return refuse(`Only a bill of today's business day can be voided. This one is of ${o.business_date}.`);
    }
    if (await dayClosed(client, o.outlet_id, o.business_date)) {
      return refuse("The restaurant's day is closed and its drawer counted. A bill of a closed day cannot be voided.");
    }

    const { rows: [paid] } = await client.query<{ cash: string; other: boolean }>(
      `select coalesce(sum(amount) filter (where method = 'cash'), 0)::text as cash,
              bool_or(method not in ('cash', 'allowance')) as other
         from pos_order_tenders where order_id = $1`,
      [orderId],
    );
    if (paid!.other && !reference) {
      return refuse("Give the refund's reference: the UPI reference or the card approval.");
    }
    const cash = Number(paid!.cash);
    /* The refunds' cash ceiling (D27-315 B), the same until the CA answers (D27-327). */
    if (cash >= CASH_REFUND_CEILING) {
      return refuse("Cash is given back only below ₹20,000 on a bill until the hotel's CA "
        + "confirms that limit, so this bill cannot be voided here.");
    }

    await client.query(
      `update pos_orders
          set status = 'void', voided_by = $2, voided_at = now(),
              void_reason = $3, void_reference = $4
        where id = $1`,
      [orderId, session.staffId, reason, reference],
    );
    /* Nothing is collected on it: its table is freed as Clear frees one
       (POS-33), so the floor never shows a voided bill. */
    await client.query(CLEAR_FINISHED, [orderId]);
    return { ok: true };
}

till.post("/:code/till/orders/:id/void", async (c) => {
  const input = await c.req.json<{ reason?: string; reference?: string }>()
    .catch(() => ({}) as { reason?: string; reference?: string });
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse("Say why this bill is being voided. The reason stays on the bill."), 409);
  }
  const reference = input.reference?.trim() || null;

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const done = await voidBill(client, session, hotelId, orderId, reason, reference);
    if (!done.ok) return done;
    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── A BILL GIVEN FREE: NC, NO CHARGE (the owner's D27-351, 21 October) ──
   The owner, an administrator or the GM (roleGate NO_CHARGE, and the
   database's app.gives_pos_no_charge behind it) closes an OPEN bill as NC,
   with a reason; their name on it is the approval. It prints the dishes with
   no prices, marked NC (heading 'nc'). No value anywhere: every sales figure
   reads `status = 'settled'`. Never a bill on a function's bill - the host
   pays it there. Every refusal comes before the one write (MEMORY 243). */
/** An open bill given free - by the owner, an Admin or the GM at the till,
    or by one of them approving a request (D27-363), as `session`. */
export async function noChargeBill(
  client: Client, session: Session, hotelId: string, orderId: string, reason: string,
): Promise<Act> {
    /* Locked, as a settle is: an NC and a payment pressed together cannot
       both close it. */
    const { rows: [o] } = await client.query<{
      status: string; outlet_id: string; business_date: string; event_title: string | null;
      on_function: boolean; dishes: number;
    }>(
      `select o.status, o.outlet_id::text,
              to_char(o.business_date, 'YYYY-MM-DD') as business_date,
              e.title as event_title, o.event_id is not null as on_function,
              (select count(*)::int from pos_order_lines l
                where l.order_id = o.id and not l.voided) as dishes
         from pos_orders o
         left join banquet_events e on e.id = o.event_id
        where o.id = $1 and o.hotel_id = $2
          for update of o`,
      [orderId, hotelId],
    );
    if (!o) return refuse("No such order.");
    if (o.status === "no_charge") return refuse("This bill is already NC.");
    if (o.status !== "open") return refuse(`This bill is already ${o.status}.`);
    if (o.on_function) {
      return refuse(`This order is on ${o.event_title ?? "a function"}'s bill: the host pays it there. `
        + "Take it off the function first.");
    }
    if (o.dishes === 0) return refuse("There is nothing on this order. Add an item, or close it unpaid.");
    if (await dayClosed(client, o.outlet_id, o.business_date)) return refuse(DAY_CLOSED);

    await client.query(
      `update pos_orders
          set status = 'no_charge', nc_by = $2, nc_at = now(), nc_reason = $3
        where id = $1`,
      [orderId, session.staffId, reason],
    );
    /* Nothing is collected on it: its table is freed as a void's is. */
    await client.query(CLEAR_FINISHED, [orderId]);
    return { ok: true };
}

till.post("/:code/till/orders/:id/no-charge", async (c) => {
  const input = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(refuse("Say why this bill is no charge. The reason prints on the bill."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const done = await noChargeBill(client, session, hotelId, orderId, reason);
    if (!done.ok) return done;
    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Changing a quantity ──────────────────────────────────────────────
   Every till in the trade puts +/- on a line. Without it, "make that two
   rather than three" means striking the line and re-adding — which leaves
   a cancelled row on the kitchen copy for something the guest is still
   getting, and reads as a mistake nobody made.
   ═══════════════════════════════════════════════════════════════════ */
till.post("/:code/till/orders/:id/lines/:lineId/qty", async (c) => {
  type Body = { qty?: number; reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const reason = input.reason?.trim() || undefined;

  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return c.json(refuse("A quantity cannot be negative."), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    const { rows: line } = await client.query<{
      qty: string; sent: boolean; addon_ids: string[]; extra_choice_ids: string[];
      item_id: string | null; variation_id: string | null; note: string | null;
      numbered_addons: LineAddons | null; extra_kind: string | null;
    }>(
      `select qty::text, kot_status <> 'pending' as sent,
              array(select a.addon_id::text from pos_order_lines a
                     where a.parent_line_id = l.id and not a.voided
                       and a.addon_id is not null) as addon_ids,
              item_id::text, variation_id::text, note, extra_choice_ids::text[],
              numbered_addons, extra_kind
         from pos_order_lines l
        where id = $1 and order_id = $2 and not voided
        for update`,
      [c.req.param("lineId"), orderId],
    );
    if (!line[0]) return refuse("That line is struck, or is not here.");
    /* An add-on line's number is set when it goes on (D27-291): strike it,
       and add it again with the right number. */
    if (line[0].extra_kind && qty > 0) {
      return refuse("An add-on's number is set when it goes on. Strike it and add it again.");
    }
    /* More of a dish is ordering it (D27-324): the bar, the bar's dishes only. */
    if (qty > Number(line[0].qty) && line[0].item_id) {
      const notTheBars = await barRefusal(client, hotelId, line[0].item_id);
      if (notTheBars) return notTheBars;
    }
    /* MORE of a dish the kitchen has is a new line, for the next docket -
       the same as tapping it again (the owner, 28 September), sides and
       all (D27-192, Q7). */
    const moreSent = line[0].sent && qty > Number(line[0].qty);
    /* Fewer of a dish the kitchen already has is a strike (D27-119). */
    const fewerSent = line[0].sent && qty < Number(line[0].qty);
    if (fewerSent) {
      const why = await sentStrikeRefusal(client, session, hotelId, reason);
      if (why) return refuse(why);
    }

    if (qty === 0) {
      /* Down to nothing is a strike, not a delete. A waiter counting to
         zero means the same thing as pressing the cross, and the line
         stays visible either way — 028 keeps struck lines because a
         manager settling a dispute wants to see them. */
      const { rowCount } = await client.query(
        `update pos_order_lines
            set voided = true, voided_by = $1, voided_at = now(), void_reason = $4
          where id = $2 and order_id = $3 and not voided`,
        [session.staffId, c.req.param("lineId"), orderId, reason ?? null],
      );
      if (!rowCount) return refuse("That line is already struck.");
    } else if (moreSent) {
      /* Through the one place a dish goes on (D27-189): it joins the unsent
         line of the same dish, and starts one only when there is none. Its
         own insert here made a new line on every press. */
      const l = line[0];
      const refused = await addOneLine(client, session, hotelId, orderId, {
        qty: qty - Number(l.qty), addonIds: l.addon_ids,
        moreChoiceIds: l.extra_choice_ids,
        /* Its numbered add-ons too (D27-289): one more Biryani with Kebab. */
        ...(l.numbered_addons ? {
          numberedAddons: l.numbered_addons.addons.map((a) => ({ id: a.id, qty: a.qty })),
        } : {}),
        ...(l.item_id ? { itemId: l.item_id } : {}),
        ...(l.note ? { note: l.note } : {}),
        ...(l.variation_id ? { variationId: l.variation_id } : {}),
      });
      if (refused) return refused;
    } else if (fewerSent) {
      /* THREE SENT, TWO WANTED: the one that goes is a struck line of its
         own, from the same ticket, so the docket, the pass and the day's
         list show one dish taken off and why - and the two stay as sent. */
      await client.query(
        `insert into pos_order_lines
           (order_id, hotel_id, item_id, variation_id, name, qty, unit_price,
            tax_rate, tax_scheme, note, added_by, added_at, kot_status,
            kot_sent_at, kot_no, voided, voided_by, voided_at, void_reason,
            was_sent_when_voided, numbered_addons, extra_choice_ids)
         select order_id, hotel_id, item_id, variation_id, name, qty - $2,
                unit_price, tax_rate, tax_scheme, note, added_by, added_at,
                kot_status, kot_sent_at, kot_no, true, $3, now(), $4, true,
                /* What the dish WAS, every part of it (POS-34): without its
                   further choices, 164's trigger refused a Pizza with no
                   crust and the manager got "Something went wrong". */
                numbered_addons, extra_choice_ids
           from pos_order_lines where id = $1`,
        [c.req.param("lineId"), qty, session.staffId, reason],
      );
      /* Its sides go with it (D27-189): two plates, two lots of onions.
         Its add-on lines keep their own number (D27-291). */
      await client.query(
        `update pos_order_lines set qty = $1
          where (id = $2 or (parent_line_id = $2 and addon_id is not null))
            and not voided`,
        [qty, c.req.param("lineId")],
      );
    } else {
      const { rowCount } = await client.query(
        `update pos_order_lines set qty = $1
          where (id = $2 or (parent_line_id = $2 and addon_id is not null))
            and order_id = $3 and not voided`,
        [qty, c.req.param("lineId"), orderId],
      );
      if (!rowCount) return refuse("That line is struck, or is not here.");
    }

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Customise: the numbered add-ons on a dish not yet sent (D27-289) ──
   The Till and the Terminal put a dish on the bill when it is tapped, so
   Customise there changes a line that already exists. ONLY BEFORE SEND
   (the owner): once the kitchen has it, the waiter adds a fresh line - and
   208's trigger refuses it against every role. The whole set is sent each
   time; an empty set takes them all off. The dish's name and price are
   worked again from what the line kept before its add-ons, so Customising
   twice never adds the Kebab twice. */
till.post("/:code/till/orders/:id/lines/:lineId/numbered-addons", async (c) => {
  /* `just: 1` (the owner's D27-290): on a line of several, the add-ons go
     on ONE of them - "3 Biryani, one with Kebab" - which is split off as
     its own line; the rest stay as they were. Absent: every one. */
  type Body = { numberedAddons?: NumberedChoice[]; just?: number; extras?: ExtraInput[] };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{ status: string }>(
      `select status from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status} and cannot be changed.`);
    }

    const { rows: line } = await client.query<{
      name: string; unit_price: string; kot_status: string;
      numbered_addons: LineAddons | null; item_id: string | null;
      parent_line_id: string | null; qty: string; variation_id: string | null;
      extra_choice_ids: string[]; note: string | null; addon_ids: string[];
      tax_rate: string; tax_scheme: string;
    }>(
      `select l.name, l.unit_price::text, l.kot_status, l.numbered_addons,
              l.item_id::text, l.parent_line_id::text, l.qty::text,
              l.variation_id::text, l.extra_choice_ids::text[], l.note,
              l.tax_rate::text, l.tax_scheme,
              array(select a.addon_id::text from pos_order_lines a
                     where a.parent_line_id = l.id and not a.voided
                       and a.addon_id is not null) as addon_ids
         from pos_order_lines l
        where l.id = $1 and l.order_id = $2 and not l.voided
        for update`,
      [c.req.param("lineId"), orderId],
    );
    if (!line[0]) return refuse("That line is struck, or is not here.");
    if (line[0].parent_line_id || !line[0].item_id) {
      return refuse("Add-ons go on a dish, not on a side.");
    }
    const dish = line[0].numbered_addons?.dish ?? line[0].name;
    if (line[0].kot_status !== "pending") {
      return refuse(`The kitchen already has ${dish}. Add a fresh line for its add-ons.`);
    }

    /* The set, always: an empty one is the deliberate way to take them all
       off; a body that is missing or did not parse is not, and must not
       quietly reprice the dish (the audit of 9 October). */
    if (!Array.isArray(input.numberedAddons)) return refuse("Which add-ons?");
    if (input.just !== undefined && input.just !== 1) return refuse("Just one, or all of them?");
    /* Typed add-ons chosen in the same Customise (D27-291): lines of their
       own under the dish - or under the one split off, on Just 1. */
    const extras = await extrasFor(client, hotelId, input.extras);
    if (!extras.ok) return extras;

    /* JUST ONE of several: through the one place a dish goes on, so it is
       priced, named and merged as any dish is - with this line's variation,
       choices, sides and note - and the line it came from is one fewer,
       with its sides. Every refusal is addOneLine's, before its first write
       (root MEMORY 243); the one fewer comes only after it went on. */
    const l = line[0];
    if (input.just === 1 && Number(l.qty) > 1) {
      const refused = await addOneLine(client, session, hotelId, orderId, {
        ...(l.item_id ? { itemId: l.item_id } : {}), qty: 1,
        ...(l.variation_id ? { variationId: l.variation_id } : {}),
        moreChoiceIds: l.extra_choice_ids,
        addonIds: l.addon_ids,
        ...(l.note ? { note: l.note } : {}),
        numberedAddons: input.numberedAddons,
        ...(input.extras ? { extras: input.extras } : {}),
      });
      if (refused) return refused;
      await client.query(
        `update pos_order_lines set qty = qty - 1
          where (id = $1 or (parent_line_id = $1 and addon_id is not null)) and not voided`,
        [c.req.param("lineId")]);
      return { ok: true as const, ...(await readOrder(client, orderId))! };
    }

    const numbered = await numberedFor(client, hotelId, input.numberedAddons);
    if (!numbered.ok) return numbered;
    const base = line[0].numbered_addons ? String(line[0].numbered_addons.base) : line[0].unit_price;
    const kept = lineAddons(dish, base, numbered.addons);

    await client.query(
      `update pos_order_lines
          set name = $1, unit_price = $2, numbered_addons = $3::jsonb
        where id = $4`,
      [nameWithAddons(dish, numbered.addons), priceWithAddons(base, numbered.addons),
       kept === null ? null : JSON.stringify(kept), c.req.param("lineId")],
    );
    await insertExtras(client, {
      orderId, hotelId, parentId: c.req.param("lineId"), taxRate: l.tax_rate,
      taxScheme: l.tax_scheme, staffId: session.staffId,
    }, extras.extras);

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Add-ons under a dish on the bill, from the Till and the Terminal ──
   (the owner's D27-291). The dish may already be with the kitchen: each
   add-on is a line of its own under it and waits for the next Send. The pad
   sends the same through the batch, with the round (extraFor). Its own
   address, so it is refused offline as Customise is (src/lib/offline.ts):
   held, a retry would add it twice. */
till.post("/:code/till/orders/:id/lines/:lineId/extras", async (c) => {
  const input = await c.req.json<{ extras?: ExtraInput[] }>()
    .catch(() => ({}) as { extras?: ExtraInput[] });

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const refused = await addOneLine(client, session, hotelId, orderId, {
      extraFor: c.req.param("lineId"), ...(input.extras ? { extras: input.extras } : {}),
    });
    if (refused) return refused;
    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Sending to the kitchen ───────────────────────────────────────────
   KOT and BILL are two different acts. A table orders starters, the
   kitchen starts on them, the table orders mains twenty minutes later,
   and the bill happens once at the end. Collapsing them — which this
   till did — means the kitchen hears about the food when the guest asks
   to pay.

   Only PENDING lines are sent. Firing the whole order again would put
   the starters back on the pass while they are being eaten.
   ═══════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   SENDING A DOCKET TO THE KITCHEN

   Shared by the kot route below and by the batch endpoint, because a
   waiter building an order on the floor sends it once — the order and
   its dishes and the docket in a single request, not three.

   THE DOCKET NUMBER GOES WITH THE BATCH, not the order. Starters, then
   mains, then the dessert somebody changed their mind about: three
   dockets, three numbers, one bill. A kitchen holding three pieces of
   paper that all say KOT-5 cannot tell the chef which is which.

   Taken inside the same statement that sends the lines, so two waiters
   sending at once cannot both read the same number and print it twice.
   ══════════════════════════════════════════════════════════════════ */
/* A PARCEL'S PACKING CHARGE (the owner's D27-359): on its first KOT, once,
   the GM's amount (pos_outlets.packing_charge), taxed as the food. A bill
   line, not a dish: already 'served' and marked packing, so no KOT, kitchen
   screen or reprint shows it, and the bill, its tax and the reports add it
   up as any line. Once struck by a manager it is not put back. No charge
   set, or no GST rule for the food: nothing. */
async function addPacking(client: Client, orderId: string, kotNo: number, staffId: string) {
  await client.query(
    `insert into pos_order_lines
       (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by,
        kot_status, kot_sent_at, kot_no, packing)
     select o.id, o.hotel_id, 'Packing charge', 1, ou.packing_charge,
            app.gst_rate_or_null(o.hotel_id, 'restaurant', ou.packing_charge),
            $3, 'served', now(), $2, true
       from pos_orders o join pos_outlets ou on ou.id = o.outlet_id
      where o.id = $1 and o.order_type = 'takeaway' and ou.packing_charge is not null
        and app.gst_rate_or_null(o.hotel_id, 'restaurant', ou.packing_charge) is not null
        and not exists (select 1 from pos_order_lines l where l.order_id = o.id and l.packing)`,
    [orderId, kotNo, staffId]);
}

async function fireKot(
  client: Client, outletId: string, businessDate: string, orderId: string, staffId: string,
): Promise<{ sent: number; kotNo: number }> {
  const { rows: next } = await client.query<{ no: number }>(
    `select app.pos_next_kot_no($1, $2::date) as no`,
    [outletId, businessDate],
  );
  const kotNo = next[0]!.no;

  const { rowCount } = await client.query(
    `update pos_order_lines
        set kot_status = 'sent', kot_sent_at = now(), kot_no = $2
      where order_id = $1 and not voided and kot_status = 'pending'`,
    [orderId, kotNo],
  );
  if (rowCount) await addPacking(client, orderId, kotNo, staffId);

  return { sent: rowCount ?? 0, kotNo };
}

/* ══════════════════════════════════════════════════════════════════
   A WHOLE ORDER, IN ONE REQUEST

   A waiter standing at a table builds the order on the pad in their
   hand: six taps, no network, nothing to wait for. Then one Send.

   ⚠ ALL OF IT OR NONE OF IT. `withUser` runs this inside one
   transaction, so a dish the kitchen refuses — off the menu, an outlet
   closed, a variation not chosen — must ROLL THE WHOLE THING BACK.
   Half an order on a bill is worse than no order: the waiter believes
   they sent six dishes and the kitchen cooks four, and nobody finds out
   until the table complains.

   That is why a refusal here THROWS rather than returning. Returning
   would let the transaction commit whatever had already been written.

   THE PRICES ARE THE SERVER'S. The pad shows what the menu said when it
   was loaded, which is the right thing to show a waiter — but every
   price, tax rate and total on the bill is computed here, from the
   database, at the moment of sending. The reply carries the whole
   order back so the pad can replace its own arithmetic with the real
   figures.
   ══════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   A GUEST'S ORDER, ACCEPTED (D27-224, D27-225; the in-stay plan, A)

   The round is the stored basket, never the Terminal's copy of it. Each
   line is priced again by the one rule the guest's order was priced by
   (app.guest_dish_price): a dish no longer on the menu, or a price that
   moved, refuses the Accept naming the dish, and the waiter declines with
   the reason the guest reads - never more than the guest saw (Q1). The
   restaurant must still be taking orders for that stay (Q5).
   ══════════════════════════════════════════════════════════════════ */
type GuestLine = {
  itemId: string; qty: number; variationId: string | null;
  moreChoiceIds: string[]; addonIds: string[]; name: string; unitPrice: number;
};

async function guestOrderRound(
  client: Client, hotelId: string, id: string,
): Promise<{ lines: LineInput[]; table: string } | { reason: string }> {
  const { rows: g } = await client.query<{
    reservation_id: string; basket: GuestLine[]; note: string | null; status: string;
    open: boolean; room: string | null;
  }>(
    `select f.reservation_id::text, f.basket, f.note, f.status,
            app.guest_dining_outlet(f.reservation_id) is not null as open,
            (select r.number from room_assignments ra join rooms r on r.id = ra.room_id
              where ra.reservation_id = f.reservation_id and ra.released_at is null
              order by ra.from_date desc, ra.created_at desc limit 1) as room
       from guest_food_orders f
      where f.id::text = $1 and f.hotel_id = $2`,
    [id, hotelId]);
  const order = g[0];
  if (!order) return { reason: "No such guest order." };
  if (order.status !== "waiting") return { reason: `This guest order was already ${order.status}.` };
  if (!order.open) {
    return { reason: "The restaurant is not taking room orders now, or the guest has left. Decline it and say why." };
  }

  const lines: LineInput[] = [];
  for (const [i, l] of order.basket.entries()) {
    const { rows: p } = await client.query<{ unit_price: string | null }>(
      "select unit_price::text from app.guest_dish_price($1, $2, $3, $4::uuid[], $5::uuid[])",
      [hotelId, l.itemId, l.variationId, l.moreChoiceIds, l.addonIds]);
    const now = p[0]?.unit_price ?? null;
    if (now === null) return { reason: `${l.name} is not on the menu now. Decline it and say why.` };
    if (Math.round(Number(now) * 100) !== Math.round(Number(l.unitPrice) * 100)) {
      return { reason: `The price of ${l.name} has changed since the guest ordered. Decline it and say why.` };
    }
    lines.push({
      itemId: l.itemId, qty: l.qty,
      ...(l.variationId ? { variationId: l.variationId } : {}),
      ...(l.moreChoiceIds.length ? { moreChoiceIds: l.moreChoiceIds } : {}),
      ...(l.addonIds.length ? { addonIds: l.addonIds } : {}),
      /* The guest's one note, on the first dish (Q3). */
      ...(i === 0 && order.note ? { note: order.note } : {}),
    });
  }
  return { lines, table: order.room ? `Room ${order.room}` : "Room service" };
}

/* The guest orders waiting for the restaurant: the room, what, the note. */
till.get("/:code/till/guest-orders", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      id: string; basket: GuestLine[]; note: string | null; created_at: string; room: string | null;
    }>(
      `select f.id::text, f.basket, f.note, f.created_at::text,
              (select r.number from room_assignments ra join rooms r on r.id = ra.room_id
                where ra.reservation_id = f.reservation_id and ra.released_at is null
                order by ra.from_date desc, ra.created_at desc limit 1) as room
         from guest_food_orders f
        where f.hotel_id = $1 and f.status = 'waiting'
        order by f.created_at`,
      [hotelId]);
    return {
      orders: rows.map((r) => ({
        id: r.id, room: r.room, note: r.note, createdAt: r.created_at,
        lines: r.basket.map((l) => ({ name: l.name, qty: l.qty, unitPrice: Number(l.unitPrice) })),
      })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* Declined, with the reason the guest reads on their page. */
till.post("/:code/till/guest-orders/:id/decline", async (c) => {
  const input = await c.req.json<{ reason?: unknown }>().catch(() => ({}) as { reason?: unknown });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 200) {
    return c.json(refuse("Say why, in a line the guest will read."), 409);
  }
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      `update guest_food_orders
          set status = 'declined', reason = $3, handled_by = $4, handled_at = now()
        where id::text = $1 and hotel_id = $2 and status = 'waiting'`,
      [c.req.param("id"), hotelId, reason, session.staffId]);
    return rowCount ? { ok: true as const } : refuse("This guest order was already answered.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

class LineRefused extends Error {
  /* ⚠ WRITTEN OUT LONGHAND, NOT AS PARAMETER PROPERTIES.
     `constructor(public readonly reason: string, ...)` is valid
     TypeScript, passes `tsc`, and runs fine under vitest and tsx — and
     it KILLED THE PRODUCTION API on deploy:

       SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]
       TypeScript parameter property is not supported in strip-only mode

     The server runs `node --experimental-strip-types`, which ERASES
     types and emits nothing. A parameter property needs an emitted
     `this.reason = reason`, so it is the one piece of TypeScript that
     cannot survive there. Nothing in the local gates runs the API that
     way, which is why three clean builds and 272 tests said nothing.

     `npm run strip-check` now parses every file the way the server
     does. Run it before you deploy. */
  readonly reason: string;
  readonly at: number;

  constructor(reason: string, at: number) {
    super(reason);
    this.reason = reason;
    this.at = at;
  }
}

till.post("/:code/till/orders/batch", async (c) => {
  type BatchBody = {
    outlet?: string;
    /* An order already open at this table — a second round. Absent
       means open a new one. */
    orderId?: string;
    table?: string;
    tableId?: string;
    orderType?: string;
    lines?: LineInput[];
    /* Send to the kitchen in the same breath. A waiter who has finished
       taking an order has finished; making them press twice is a tap
       they pay for at every table. */
    send?: boolean;
    /* The banquet function this order goes on (D17-21), chosen on the
       pad. Null takes an open order off its function; absent leaves it. */
    eventId?: string | null;
    /* A guest's order from their own page (D27-224, D27-225): its stored
       basket is the round, a room-service order for the stay's room, sent
       at once; the guest order is accepted in this same transaction. */
    guestOrderId?: string;
  };
  const input = await c.req.json<BatchBody>().catch(() => ({}) as BatchBody);

  if (input.eventId !== undefined && input.eventId !== null
      && typeof input.eventId !== "string") {
    return c.json(refuse("Which function is this order for?"), 409);
  }

  let lines = input.lines ?? [];
  if (lines.length === 0 && !input.guestOrderId) {
    return c.json(refuse("There is nothing to send."), 409);
  }
  if (lines.length > 100) {
    /* Not a real order. A guard against a loop somewhere, not against a
       large table. */
    return c.json(refuse("That is more than a hundred lines."), 409);
  }
  if (!input.outlet && !input.orderId && !input.guestOrderId) {
    return c.json(refuse("Which outlet is this order for?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    let orderId = input.orderId ?? null;
    let outletId: string;
    let businessDate: string;
    let opened = false;

    if (input.guestOrderId) {
      if (orderId) return refuse("A guest's order is a new room-service order.");
      const round = await guestOrderRound(client, hotelId, input.guestOrderId);
      if ("reason" in round) return refuse(round.reason);
      lines = round.lines;
      input.outlet = "REST";
      input.table = round.table;
      delete input.tableId;
      input.orderType = "room_service";
      input.send = true;
    }

    /* The banquet service's rule, before anything is written (D17-21;
       MEMORY 243). The same rule as the header route's. */
    if (input.eventId) {
      const why = await whyNotAttachable(client, hotelId, input.eventId);
      if (why) return refuse(why);
    }

    if (orderId) {
      const { rows } = await client.query<{
        status: string; outlet_id: string; business_date: string;
      }>(
        `select status, outlet_id::text,
                to_char(business_date,'YYYY-MM-DD') as business_date
           from pos_orders where id = $1 and hotel_id = $2`,
        [orderId, hotelId],
      );
      if (!rows[0]) return refuse("No such order.");
      if (rows[0].status !== "open") {
        return refuse(
          `That order is ${rows[0].status}. Start a new one for this table.`,
        );
      }
      outletId = rows[0].outlet_id;
      businessDate = rows[0].business_date;

      if (input.eventId !== undefined) {
        await client.query(
          `update pos_orders set event_id = $1, updated_at = now()
            where id = $2 and hotel_id = $3`,
          [input.eventId || null, orderId, hotelId],
        );
      }
    } else {
      const { rows: outlet } = await client.query<{ id: string }>(
        `select id::text from pos_outlets
          where hotel_id = $1 and code = $2 and is_active`,
        [hotelId, input.outlet!.toUpperCase()],
      );
      if (!outlet[0]) return refuse("No such outlet.");
      outletId = outlet[0].id;

      const bd = await businessDateFor(client, hotelId);
      businessDate = bd;
      if (await dayClosed(client, outletId, bd)) return refuse(DAY_CLOSED);

      /* A typed table is the floor's table of that name (QA POS-3), and a
         table with a bill running takes no second one. */
      const tableId = input.tableId
        || (await tableNamed(client, outletId, input.table)) || null;
      const busy = tableId && !input.tableId ? await runningOn(client, tableId) : null;
      if (busy) return refuse(`${input.table!.trim()} already has ${busy} running on it.`);

      /* THE TABLE'S NAME IS COPIED ONTO THE ORDER, as opening one by
         itself does (above): the kitchen slip, the bill and the Terminal's
         list all print `table_ref`. This route kept only `table_id`, so
         every order taken on Tables printed with no table — found 17
         September opening the slip Tables now opens (POS-12). The floor's
         name wins over typed text, the same as there. */
      const { rows: made } = await client.query<{ id: string }>(
        `insert into pos_orders
           (hotel_id, outlet_id, order_no, business_date, opened_by,
            table_ref, table_id, order_type, event_id)
         values ($1, $2, app.pos_next_order_no($1, $3::date), $3::date, $4,
                 coalesce((select t.label from pos_tables t where t.id = $6::uuid), $5),
                 $6::uuid, coalesce($7, 'dine_in'), $8::uuid)
         returning id::text`,
        [hotelId, outletId, businessDate, session.staffId,
         input.table?.trim() || null, tableId,
         input.orderType || null, input.eventId || null],
      );
      orderId = made[0]!.id;
      opened = true;
    }

    /* Every dish through the SAME function the single-tap route uses.
       A second copy of the pricing would agree today and price a
       variation differently in six months. */
    for (let i = 0; i < lines.length; i++) {
      const refused = await addOneLine(
        client, session, hotelId, orderId, lines[i]!);
      if (refused) throw new LineRefused(refused.reason, i);
    }

    let kot: { sent: number; kotNo: number } | null = null;
    if (input.send) {
      kot = await fireKot(client, outletId, businessDate, orderId, session.staffId);
    }

    /* Accepted only if it is still waiting: a second Accept, or a Decline
       between the two, throws and takes this whole order back with it. */
    if (input.guestOrderId) {
      const { rowCount } = await client.query(
        `update guest_food_orders
            set status = 'accepted', pos_order_id = $2, handled_by = $3, handled_at = now()
          where id = $1 and status = 'waiting'`,
        [input.guestOrderId, orderId, session.staffId]);
      if (!rowCount) {
        throw new LineRefused("This guest order was already answered. Nothing was sent.", -1);
      }
    }

    return {
      ok: true as const,
      opened,
      ...(kot ? { sent: kot.sent, kotNo: kot.kotNo } : {}),
      ...(await readOrder(client, orderId))!,
    };
  }).catch((error: unknown) => {
    /* The throw rolled the transaction back, so nothing was written.
       Said with the dish's position, because "a variation is required"
       is not actionable when six dishes went up at once. */
    if (error instanceof LineRefused && error.at < 0) return refuse(error.reason);
    if (error instanceof LineRefused) {
      return refuse(
        `Nothing was sent. Dish ${error.at + 1} could not be added: ` +
        `${error.reason}`,
      );
    }
    throw error;
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/orders/:id/kot", async (c) => {
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows: order } = await client.query<{
      status: string; outlet_id: string; business_date: string;
    }>(
      `select status, outlet_id::text,
              to_char(business_date,'YYYY-MM-DD') as business_date
         from pos_orders where id = $1 and hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is ${order[0].status}. Nothing to send.`);
    }

    /* THE DOCKET NUMBER GOES WITH THE BATCH, not the order. Starters,
       then mains, then the dessert somebody changed their mind about:
       three dockets, three numbers, one bill. A kitchen holding three
       pieces of paper that all say KOT-5 cannot tell the chef which is
       which.

       Taken inside the same statement that sends the lines, so two
       waiters sending at once cannot both read the same number and
       print it twice. */
    const { rows: next } = await client.query<{ no: number }>(
      `select app.pos_next_kot_no($1, $2::date) as no`,
      [order[0].outlet_id, order[0].business_date],
    );
    const kotNo = next[0]!.no;

    const { rowCount: sent } = await client.query(
      `update pos_order_lines
          set kot_status = 'sent', kot_sent_at = now(), kot_no = $2
        where order_id = $1 and not voided and kot_status = 'pending'`,
      [orderId, kotNo],
    );

    if (!sent) {
      return refuse(
        "Everything on this order is already with the kitchen. Add "
        + "something first.",
      );
    }
    await addPacking(client, orderId, kotNo, session.staffId);

    return {
      ok: true as const,
      sent,
      /* Handed back so the till can print THIS docket without asking
         again — and so a waiter who wants the paper knows which number
         to expect out of the machine. */
      kotNo,
      ...(await readOrder(client, orderId))!,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── One docket, for printing ─────────────────────────────────────
   What the kitchen printer gets: the batch that went out under this
   number, dishes with their add-ons nested underneath. The pass screen
   stays and is better than paper — oldest first, colour by wait, a
   struck dish shown loudly — but most kitchens run on the docket. */

till.get("/:code/till/orders/:id/kot/:no", async (c) => {
  /* One kind's slip of the docket (D27-292): "BAR KOT 14" is only the bar's
     lines. Absent, the whole docket, as before. */
  const kindParam = c.req.query("kind");
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const kotNo = Number(c.req.param("no"));
    if (!Number.isInteger(kotNo)) return null;
    let kind: { id: string; name: string } | null = null;
    if (kindParam) {
      const { rows: k } = await client.query<{ id: string; name: string }>(
        `select id::text, name from pos_kot_kinds where id::text = $1 and hotel_id = $2`,
        [kindParam, hotelId]);
      if (!k[0]) return null;
      kind = k[0];
    }

    const { rows: head } = await client.query<{
      order_no: string; table_ref: string | null; order_type: string;
      outlet_name: string; hotel_name: string; sent_at: string | null;
      covers: number | null; waiter: string | null;
    }>(
      `select o.order_no, o.table_ref, o.order_type,
              ou.name as outlet_name, h.name as hotel_name,
              app.hotel_clock($2::uuid, min(l.kot_sent_at), 'DD/MM/YY HH24:MI') as sent_at,
              /* The KOT's design may print them (D27-368). */
              o.covers, w.full_name as waiter
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
         join hotels h on h.id = o.hotel_id
         left join staff w on w.id = o.waiter_id
         join pos_order_lines l on l.order_id = o.id and l.kot_no = $3 and not l.packing
        where o.id = $1 and o.hotel_id = $2
        group by o.order_no, o.table_ref, o.order_type, ou.name, h.name, o.covers, w.full_name`,
      [orderId, hotelId, kotNo],
    );
    if (!head[0]) return null;

    const { rows } = await client.query<{
      line_id: string; parent_id: string | null; name: string;
      qty: string; note: string | null; is_addon: boolean;
    }>(
      `select k.line_id::text, k.parent_id::text, k.name, k.qty::text, k.note, k.is_addon
         from app.pos_kot($1, $2) k
        where ($3::uuid is null or app.pos_line_kot_kind(k.line_id) = $3::uuid)
          /* A parcel's packing charge is on the bill, never on a KOT (D27-359). */
          and not (select l.packing from pos_order_lines l where l.id = k.line_id)`,
      [orderId, kotNo, kind?.id ?? null],
    );

    /* THE DISH, WITH "+ Kebab" UNDER IT (the owner, D27-289): a cook must not
       read past an add-on folded into a name. The dish as named before its
       numbered add-ons, and each of them as a line of its own on the slip -
       still one ticket. */
    const { rows: numberedRows } = await client.query<{
      id: string; numbered_addons: LineAddons;
    }>(
      `select id::text, numbered_addons from pos_order_lines
        where id = any($1::bigint[]) and numbered_addons is not null`,
      [rows.map((r) => r.line_id)],
    );
    const numberedOf = new Map(numberedRows.map((r) => [r.id, r.numbered_addons]));

    /* AN ADD-ON FOR A DISH ON AN EARLIER KOT (D27-291): its dish is not on
       this slip, so the slip says which it is for - "+ Extra papad, for Veg
       Thali (KOT 12)". */
    const here = new Set(rows.map((r) => r.line_id));
    const away = [...new Set(rows.flatMap((r) =>
      r.parent_id && !r.is_addon && !here.has(r.parent_id) ? [r.parent_id] : []))];
    const { rows: dishes } = away.length === 0 ? { rows: [] } : await client.query<{
      id: string; name: string; kot_no: number | null;
    }>(
      `select id::text, coalesce(numbered_addons ->> 'dish', name) as name, kot_no
         from pos_order_lines where id = any($1::bigint[])`,
      [away]);
    const dishOf = new Map(dishes.map((d) => [d.id, d]));

    /* What came off this docket after it was sent, and why (D27-119): a
       reprint tells the kitchen to stop, with the manager's reason. */
    const { rows: struck } = await client.query<{
      name: string; qty: string; reason: string | null;
    }>(
      `select case when extra_kind is null then name else '+ ' || name end as name,
              qty::text, void_reason as reason from pos_order_lines
        where order_id = $1 and kot_no = $2 and voided and was_sent_when_voided
          and (parent_line_id is null or extra_kind is not null)
          and ($3::uuid is null or app.pos_line_kot_kind(id) = $3::uuid)
        order by voided_at`,
      [orderId, kotNo, kind?.id ?? null],
    );

    return {
      kotNo,
      /* Which slip (D27-292): its name heads the paper, "BAR KOT 14". */
      kind,
      orderNo: head[0].order_no,
      table: head[0].table_ref,
      orderType: head[0].order_type,
      outlet: head[0].outlet_name,
      hotel: head[0].hotel_name,
      sentAt: head[0].sent_at,
      covers: head[0].covers,
      waiter: head[0].waiter,
      lines: rows.map((r) => {
        const numbered = numberedOf.get(r.line_id);
        return {
          id: r.line_id,
          parentId: r.parent_id,
          name: numbered?.dish ?? r.name,
          qty: Number(r.qty),
          note: r.note,
          isAddon: r.is_addon,
          /* "+ Kebab", "+ Kebab ×2": per ONE of the dish, as chosen. */
          plus: (numbered?.addons ?? []).map((a) => ({ name: a.name, qty: a.qty })),
          /* An add-on as a line of its own (D27-291), with its own number. */
          extra: r.parent_id !== null && !r.is_addon,
          /* Its dish, when that went on an earlier KOT. */
          ...(r.parent_id && dishOf.has(r.parent_id) ? {
            for: { name: dishOf.get(r.parent_id)!.name, kotNo: dishOf.get(r.parent_id)!.kot_no },
          } : {}),
        };
      }),
      struck: struck.map((r) => ({ name: r.name, qty: Number(r.qty), reason: r.reason })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such docket." }, 404);
});

/* ══════════════════════════════════════════════════════════════════
   THE CLAIM BEFORE THE PAPER (D27-159; per kind since D27-292)

   A slip is claimed (a pos_kot_prints row) BEFORE it is printed, so two
   tabs on the computer cannot both print it. Only the computer that prints
   that kind may claim it. The rest of the KOT section - kinds, computers,
   routing, the station's ask, the bill printer - is kotSection.ts.
   ══════════════════════════════════════════════════════════════════ */
till.post("/:code/till/orders/:id/kot/:no/printed", async (c) => {
  const input = await c.req.json().catch(() => ({})) as { device?: unknown; kind?: unknown };
  const kotNo = Number(c.req.param("no"));
  if (!Number.isInteger(kotNo)) return c.json(refuse("No such docket."), 409);
  const kindId = typeof input.kind === "string" ? input.kind : null;
  if (!kindId) return c.json(refuse("Which KOT?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{ station: boolean }>(
      `select exists (select 1 from pos_kot_kinds k join pos_kot_stations s on s.id = k.station_id
                       where k.id::text = $4 and k.hotel_id = $2 and k.is_active
                         and s.device = $3 and s.is_active) as station
         from pos_orders o
        where o.id = $1 and o.hotel_id = $2
          and exists (select 1 from pos_order_lines l
                       where l.order_id = o.id and l.kot_no = $5)`,
      [c.req.param("id"), hotelId, deviceOf(input.device), kindId, kotNo]);
    if (!rows[0]) return refuse("No such docket.");
    if (!rows[0].station) return refuse("This computer does not print that KOT.");
    /* The claim: the first asker prints, a second tab is told no. */
    const { rowCount } = await client.query(
      `insert into pos_kot_prints (hotel_id, order_id, kot_no, kind_id) values ($1, $2, $3, $4::uuid)
       on conflict do nothing`,
      [hotelId, c.req.param("id"), kotNo, kindId]);
    return { ok: true as const, claimed: rowCount === 1 };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── The pass ─────────────────────────────────────────────────────────
   Every line the kitchen holds, oldest first. TWO STAGES (D27-221): a
   dish is ordered or on the fire; once it is Ready it is the waiter's,
   and leaves this board for Tables and the Terminal. Sorted by when it was
   SENT and not when it was rung up: a dish added to an old order still
   goes to the back of the queue, because that is when the kitchen
   learned about it.
   ═══════════════════════════════════════════════════════════════════ */
till.get("/:code/kitchen", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; order_no: string; table_ref: string | null;
      order_type: string; outlet: string; name: string; qty: string;
      note: string | null; kot_status: string; waited: string;
      voided: boolean; was_sent_when_voided: boolean;
      void_reason: string | null;
      prep_minutes: number | null;
      course: number | null;
      numbered_addons: LineAddons | null;
      for_dish: string | null;
      kind_id: string | null;
    }>(
      `select l.id::text, o.order_no, o.table_ref, o.order_type,
              ou.code as outlet, l.name, l.qty::text, l.note,
              l.kot_status, l.numbered_addons,
              /* An add-on line's dish (D27-291): "+ Extra papad, for Veg Thali". */
              case when l.extra_kind is not null
                   then (select coalesce(p.numbered_addons ->> 'dish', p.name)
                           from pos_order_lines p where p.id = l.parent_line_id) end as for_dish,
              /* Which KOT it printed on (D27-292): the board's filter. */
              coalesce(l.kot_kind_id, app.pos_line_kot_kind(l.id))::text as kind_id,
              extract(epoch from (now() - l.kot_sent_at))::int::text as waited,
              l.voided, l.was_sent_when_voided, l.void_reason,
              /* What this dish SHOULD take, from 079. Null when nobody
                 has timed it - the pass shows a dash, not a zero. */
              app.prep_minutes(l.item_id) as prep_minutes,
              /* Which course, from the one place that fallback lives.
                 NULL is an unsequenced dish - a drink - and sorts last
                 rather than ahead of the starters. */
              app.course_of(l.item_id) as course
         from pos_order_lines l
         join pos_orders o  on o.id = l.order_id
         join pos_outlets ou on ou.id = o.outlet_id
        where l.hotel_id = $1
          and l.kot_status in ('sent', 'preparing')
          /* PAID OR NOT (QA POS-1). Room service and take-away are paid or
             charged to the room when ordered, before anybody cooks them;
             reading open orders only took them off the board at once. A
             settled order's dishes stay until the kitchen says Ready -
             for the restaurant's day. A bill closed unpaid leaves, as
             before; a paid bill voided keeps its KOTs, as the kitchen made
             the food (D27-324). */
          and (o.status = 'open'
               or (o.status in ('settled', 'void', 'no_charge') and o.business_date = $2::date))
        order by l.kot_sent_at`,
      [hotelId, await businessDateFor(client, hotelId)],
    );

    return {
      lines: rows.map((r) => ({
        id: r.id,
        orderNo: r.order_no,
        table: r.table_ref,
        orderType: r.order_type,
        outlet: r.outlet,
        /* The dish, with its numbered add-ons under it (D27-289), as the
           docket prints them - one ticket, the "+ Kebab" not lost in a name. */
        name: r.numbered_addons?.dish ?? r.name,
        plus: (r.numbered_addons?.addons ?? []).map((a) => ({ name: a.name, qty: a.qty })),
        /* An add-on as a line of its own (D27-291): the dish it goes with. */
        forDish: r.for_dish,
        kindId: r.kind_id,
        qty: Number(r.qty),
        note: r.note,
        status: r.kot_status,
        /* Seconds since it reached the kitchen. The pass sorts and
           colours by this — a dish waiting eleven minutes is the only
           thing on that screen that matters. */
        waitedSeconds: Number(r.waited),
        /* The estimate: null rather than zero when unknown - an untimed
           dish is not an instant one. */
        prepMinutes: r.prep_minutes,
        course: r.course,
        /* A struck line the kitchen already had. Shown so the pass can
           stop cooking it, rather than having the ticket vanish. */
        cancelled: r.voided && r.was_sent_when_voided,
        /* Why, from the manager who struck it (D27-119). */
        cancelReason: r.voided ? r.void_reason : null,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* The kitchen's two buttons, Start and Ready (D27-221, D27-222). Served is
   the waiter's "Taken", below the till's routes - not the kitchen's. */
till.post("/:code/kitchen/lines/:lineId/:to", async (c) => {
  const to = c.req.param("to");
  if (!["preparing", "ready"].includes(to)) {
    return c.json(refuse("The kitchen starts a dish or makes it ready."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rowCount } = await client.query(
      `update pos_order_lines set kot_status = $1
        where id = $2 and hotel_id = $3 and not voided
          and kot_status <> 'pending'`,
      [to, c.req.param("lineId"), hotelId],
    );
    if (!rowCount) {
      return refuse("That dish is not with the kitchen, or was cancelled.");
    }
    return { ok: true as const, status: to };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Taken (D27-221, D27-222) ────────────────────────────────────────
   A dish the kitchen made Ready is the waiter's; "Taken" says they carried
   it, and it is served. Only a ready dish: one still cooking is not the
   waiter's to take, and one already taken is said so. The whole list is
   checked before anything is written (MEMORY 243). */
till.post("/:code/till/orders/:id/taken", async (c) => {
  const input = await c.req.json<{ lineIds?: unknown }>()
    .catch(() => ({}) as { lineIds?: unknown });
  const lineIds = Array.isArray(input.lineIds)
    ? [...new Set(input.lineIds.filter((x): x is string => typeof x === "string"))] : [];
  if (lineIds.length === 0) return c.json(refuse("Which dishes?"), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rows } = await client.query<{ id: string; name: string; kot_status: string; voided: boolean }>(
      `select l.id::text, l.name, l.kot_status, l.voided
         from pos_order_lines l join pos_orders o on o.id = l.order_id
        where l.id::text = any($3::text[]) and l.order_id = $1 and o.hotel_id = $2`,
      [orderId, hotelId, lineIds]);
    if (rows.length !== lineIds.length) return refuse("That dish is not on this order.");
    const notReady = rows.find((r) => r.voided || r.kot_status !== "ready");
    if (notReady) {
      return refuse(notReady.kot_status === "served"
        ? `${notReady.name} is already taken.`
        : `${notReady.name} is not ready yet - the kitchen says when it is.`);
    }
    await client.query(
      `update pos_order_lines set kot_status = 'served'
        where id::text = any($1::text[]) and order_id = $2`,
      [lineIds, orderId]);
    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Restaurant setup (D22-6, the owner's answers of 25 September) ───
   The restaurant's name, its sections and its tables, for the owner, an
   administrator and the GM (roleGate TILL_SETUP). Until this, only the demo
   loader made a section or a table, and only `npm run pos:outlet` made an
   outlet - one the till never opened unless somebody typed REST as its code.

   THE RESTAURANT IS `REST`, the outlet Tables, the Till and Close restaurant
   day already open. It is made by addOutlet, the one way an outlet row is made
   (the script uses it too), with no key: the people using it sign in as
   themselves. Its staff_id ("the account it posts as") only matters to an
   outside till's key, so it is the person who set it up, as the demo's is
   the owner.

   NOTHING IS DELETED (the owner): a section or a table taken away is switched
   off, and refused while a bill still sits on it. Adding the same name again
   switches it back on. Every refusal comes before the first write (MEMORY 243). */

const RESTAURANT = "REST";
/** Four across, what fits a terminal held in portrait (the demo's floor). */
const ACROSS = 4;
/** A longer run is a typing slip, not a room. */
const LONGEST_RUN = 100;

async function restaurantFor(client: Client, hotelId: string) {
  const { rows } = await client.query<{ id: string; name: string; packing_charge: string | null }>(
    `select id::text, name, packing_charge::text from pos_outlets
      where hotel_id = $1 and code = $2 and is_active`,
    [hotelId, RESTAURANT],
  );
  return rows[0] ?? null;
}

/** Seats a person typed. A blank is null (a dash), never a number nobody
    chose; anything that is not a whole number above zero is undefined,
    and refused. */
function typedSeats(raw: unknown): number | null | undefined {
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : undefined;
}
const BAD_SEATS = "Seats is a whole number, or left blank.";

/** Whatever sits on a table - an open bill, or a paid one not yet cleared -
    is what Tables shows on it (047's pos_floor), so it cannot go. */
const TABLE_BUSY = `exists (select 1 from pos_orders o
                             where o.table_id = t.id and o.cleared_at is null)`;

till.get("/:code/till/setup", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const restaurant = await restaurantFor(client, hotelId);
    const { rows } = restaurant ? await client.query<{
      section_id: string; section: string; table_id: string | null;
      label: string | null; seats: number | null; busy: boolean;
    }>(
      /* LEFT join: a section with no tables yet is exactly what somebody
         setting up has just made. pos_floor hides it; this must not. */
      `select s.id::text as section_id, s.name as section,
              t.id::text as table_id, t.label, t.seats, ${TABLE_BUSY} as busy
         from pos_sections s
         left join pos_tables t on t.section_id = s.id and t.is_active
        where s.outlet_id = $1 and s.is_active
        order by s.sort_order, s.name, t.row_no, t.col_no, t.label`,
      [restaurant.id],
    ) : { rows: [] };

    const sections: {
      id: string; name: string;
      tables: { id: string; label: string; seats: number | null; busy: boolean }[];
    }[] = [];
    for (const r of rows) {
      let s = sections.find((x) => x.id === r.section_id);
      if (!s) sections.push(s = { id: r.section_id, name: r.section, tables: [] });
      if (r.table_id) {
        s.tables.push({ id: r.table_id, label: r.label!, seats: r.seats, busy: r.busy });
      }
    }

    /* People with the Waiter role here - not an outside till's service
       account, which pos-outlet.ts gives the same role. */
    const { rows: w } = await client.query<{ n: number }>(
      `select count(*)::int as n
         from staff_hotels sh join staff s on s.id = sh.staff_id
        where sh.hotel_id = $1 and sh.role = 'pos' and s.is_active
          and not exists (select 1 from pos_outlets o where o.staff_id = s.id)`,
      [hotelId],
    );

    return {
      restaurant: restaurant ? { name: restaurant.name, packingCharge: restaurant.packing_charge === null
        ? null : Number(restaurant.packing_charge) } : null,
      sections,
      waiters: w[0]!.n,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/till/setup/restaurant", async (c) => {
  const input = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = input.name?.trim();
  if (!name) {
    return c.json(refuse("Type the restaurant's name - it is printed on every bill."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rowCount } = await client.query(
      "update pos_outlets set name = $3 where hotel_id = $1 and code = $2",
      [hotelId, RESTAURANT, name],
    );
    if (!rowCount) {
      const { rows } = await client.query<{ id: string }>(
        "select app.current_user_id()::text as id");
      await addOutlet(client, {
        hotelId, code: RESTAURANT, name, category: "food",
        staffId: rows[0]!.id, keyHash: null,
      });
    }
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

/* A PARCEL'S PACKING CHARGE (the owner's D27-359): typed by the GM, once per
   parcel, taxed as the food; blank is no charge - never a default. */
till.post("/:code/till/setup/packing", async (c) => {
  const input = await c.req.json<{ amount?: number | null }>().catch(() => ({} as { amount?: number | null }));
  const amount = input.amount ?? null;
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount >= 100000)) {
    return c.json(refuse("A packing charge is more than zero, or left blank for none."), 409);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rowCount } = await client.query(
      "update pos_outlets set packing_charge = $3 where hotel_id = $1 and code = $2",
      [hotelId, RESTAURANT, amount === null ? null : Math.round(amount * 100) / 100]);
    return rowCount ? { ok: true as const } : refuse("Name the restaurant first.");
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

till.post("/:code/till/setup/sections", async (c) => {
  const input = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = input.name?.trim();
  if (!name) return c.json(refuse("Type the section's name - A/C, Non A/C, Bar."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const restaurant = await restaurantFor(client, hotelId);
    if (!restaurant) return refuse("Name the restaurant first - its sections sit inside it.");

    const { rows: same } = await client.query<{ is_active: boolean }>(
      "select is_active from pos_sections where outlet_id = $1 and name = $2",
      [restaurant.id, name],
    );
    if (same[0]?.is_active) return refuse(`There is already a section called ${name}.`);

    await client.query(
      `insert into pos_sections (hotel_id, outlet_id, name, sort_order)
       values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 1
                              from pos_sections where outlet_id = $2))
       on conflict (outlet_id, name) do update
         set is_active = true, sort_order = excluded.sort_order`,
      [hotelId, restaurant.id, name],
    );
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.patch("/:code/till/setup/sections/:id", async (c) => {
  const input = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = input.name?.trim();
  if (!name) return c.json(refuse("Type the section's name."), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: s } = await client.query<{ outlet_id: string }>(
      `select outlet_id::text from pos_sections
        where id = $1 and hotel_id = $2 and is_active`,
      [c.req.param("id"), hotelId],
    );
    if (!s[0]) return refuse("No such section.");
    const { rows: taken } = await client.query(
      "select 1 from pos_sections where outlet_id = $1 and name = $2 and id <> $3",
      [s[0].outlet_id, name, c.req.param("id")],
    );
    if (taken[0]) return refuse(`There is already a section called ${name}.`);

    await client.query("update pos_sections set name = $2 where id = $1",
      [c.req.param("id"), name]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/setup/sections/:id/off", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ name: string; busy: string[] }>(
      `select s.name,
              array(select t.label from pos_tables t
                     where t.section_id = s.id and t.is_active and ${TABLE_BUSY}
                     order by t.label) as busy
         from pos_sections s
        where s.id = $1 and s.hotel_id = $2 and s.is_active`,
      [c.req.param("id"), hotelId],
    );
    if (!rows[0]) return refuse("No such section.");
    if (rows[0].busy.length) {
      return refuse(
        `${rows[0].name} still has a bill on ${rows[0].busy.join(", ")}. `
        + "Settle or clear those tables first.");
    }

    await client.query("update pos_sections set is_active = false where id = $1",
      [c.req.param("id")]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/setup/sections/:id/tables", async (c) => {
  type Body = { label?: string; prefix?: string; from?: unknown; to?: unknown; seats?: unknown };
  const input = await c.req.json<Body>().catch(() => ({} as Body));

  const seats = typedSeats(input.seats);
  if (seats === undefined) return c.json(refuse(BAD_SEATS), 409);

  /* One table, or a numbered run: "AC" from 1 to 10 is AC1 to AC10. A blank
     from or to is refused, never read as 0 (Number("") is 0). */
  let labels: string[];
  if (input.label?.trim()) {
    labels = [input.label.trim()];
  } else {
    const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
    const from = Number(input.from), to = Number(input.to);
    if (blank(input.from) || blank(input.to)
        || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      return c.json(refuse(
        "Type a table, or a run: a start such as AC, and the numbers from and to."), 409);
    }
    if (to - from + 1 > LONGEST_RUN) {
      return c.json(refuse(`A run is at most ${LONGEST_RUN} tables.`), 409);
    }
    const prefix = input.prefix?.trim() ?? "";
    labels = Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: s } = await client.query<{ name: string }>(
      "select name from pos_sections where id = $1 and hotel_id = $2 and is_active",
      [c.req.param("id"), hotelId],
    );
    if (!s[0]) return refuse("No such section.");

    const { rows: there } = await client.query<{ label: string }>(
      `select label from pos_tables
        where section_id = $1 and is_active and label = any($2::text[])
        order by label`,
      [c.req.param("id"), labels],
    );
    if (there.length) {
      return refuse(`${there.map((t) => t.label).join(", ")} ${
        there.length === 1 ? "is" : "are"} already in ${s[0].name}.`);
    }

    /* After the tables already there, in the order typed, ACROSS to a row. */
    await client.query(
      `insert into pos_tables (hotel_id, section_id, label, seats, row_no, col_no)
       select $1, $2, l.label, $4,
              (n.base + l.i - 1) / ${ACROSS}, (n.base + l.i - 1) % ${ACROSS}
         from unnest($3::text[]) with ordinality as l(label, i),
              (select count(*)::int as base from pos_tables
                where section_id = $2 and is_active) n
       on conflict (section_id, label) do update
         set is_active = true, seats = excluded.seats,
             row_no = excluded.row_no, col_no = excluded.col_no`,
      [hotelId, c.req.param("id"), labels, seats],
    );
    return { ok: true as const, added: labels.length };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.patch("/:code/till/setup/tables/:id", async (c) => {
  const input = await c.req.json<{ label?: string; seats?: unknown }>()
    .catch(() => ({} as { label?: string; seats?: unknown }));
  const label = input.label?.trim();
  if (!label) return c.json(refuse("Type the table's name, as it is painted on it."), 409);
  const seats = typedSeats(input.seats);
  if (seats === undefined) return c.json(refuse(BAD_SEATS), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: t } = await client.query<{ section_id: string; section: string }>(
      `select t.section_id::text, s.name as section
         from pos_tables t join pos_sections s on s.id = t.section_id
        where t.id = $1 and t.hotel_id = $2 and t.is_active`,
      [c.req.param("id"), hotelId],
    );
    if (!t[0]) return refuse("No such table.");
    const { rows: taken } = await client.query(
      "select 1 from pos_tables where section_id = $1 and label = $2 and id <> $3",
      [t[0].section_id, label, c.req.param("id")],
    );
    if (taken[0]) return refuse(`There is already a table ${label} in ${t[0].section}.`);

    await client.query("update pos_tables set label = $2, seats = $3 where id = $1",
      [c.req.param("id"), label, seats]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/setup/tables/:id/off", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ label: string; busy: boolean }>(
      `select t.label, ${TABLE_BUSY} as busy from pos_tables t
        where t.id = $1 and t.hotel_id = $2 and t.is_active`,
      [c.req.param("id"), hotelId],
    );
    if (!rows[0]) return refuse("No such table.");
    if (rows[0].busy) {
      return refuse(`${rows[0].label} has a bill on it. Settle or clear the table first.`);
    }

    await client.query("update pos_tables set is_active = false where id = $1",
      [c.req.param("id")]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
