import { Hono } from "hono";
import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { PoolClient as Client } from "pg";
/* The banquet service's rule for which functions an order may go on
   (D17-21) — through its front door, never its files. */
import { whyNotAttachable } from "../banquet/index.ts";

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
  "Type a price. A blank is not zero - type 0 for something that is free.";

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
      category_id: string; category: string; id: string | null;
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
      `select c.id::text as category_id, c.name as category,
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
        order by c.sort_order, c.name, i.sort_order, i.name`,
      [hotelId],
    );

    const byCategory = new Map<string, {
      id: string; name: string;
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
        variations: { id: string; label: string; price: number }[];
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
          id: r.category_id, name: r.category,
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
    }>(
      `select v.item_id::text, v.id::text, v.label, v.price::text
         from pos_item_variations v
         join pos_menu_items i on i.id = v.item_id
        where i.hotel_id = $1 and v.is_active
        order by v.sort_order, v.price`,
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
      items.get(v.item_id)?.variations.push({
        id: v.id, label: v.label, price: Number(v.price),
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

      const kindRaw = String(raw.taxKind ?? "").trim().toLowerCase();
      if (kindRaw && !MENU_TAX_KINDS.includes(kindRaw)) {
        return reject(
          `"${raw.taxKind}" is not a tax heading. Use `
          + `${MENU_TAX_KINDS.join(", ")}.`);
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
           on conflict (item_id, label) do update
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
   owner's answers: an "Add variation" button on each dish (D21-40); an
   add-on group made once and offered on many dishes, saying how many a
   guest may choose (D21-41); "Preferences" as options a person prices
   at 0 (D21-42). "The way Bhaaji Pau works, for the whole menu."

   REMOVED, NEVER DELETED. A line on a printed bill points at the
   variation or add-on it sold, so removing one switches it off
   (`is_active`) and the menu stops offering it. Adding the same name
   again brings the old row back at the new price.

   EVERY PRICE IS TYPED. A blank is refused, never kept as zero; a typed
   0 is a real answer - "no onion" costs nothing.
   ══════════════════════════════════════════════════════════════════ */

type Named = { label?: unknown; price?: unknown };
const labelOf = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");

till.post("/:code/till/menu/items/:id/variations", async (c) => {
  const input = await c.req.json<Named>().catch(() => ({}) as Named);
  const label = labelOf(input.label);
  if (!label) return c.json(refuse("A variation needs a name - Half, Full, 500 ml."), 409);
  const price = typedPrice(input.price);
  if (price === null) return c.json(refuse(NO_PRICE), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const itemId = c.req.param("id");

    const { rows: dish } = await client.query<{ name: string }>(
      "select name from pos_menu_items where id = $1 and hotel_id = $2",
      [itemId, hotelId]);
    if (!dish[0]) return refuse("No such dish.");

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_item_variations (hotel_id, item_id, label, price, sort_order)
       values ($1, $2, $3, $4,
               (select coalesce(max(sort_order), 0) + 1
                  from pos_item_variations where item_id = $2))
       on conflict (item_id, label) do update
         set price = excluded.price, is_active = true
         where not pos_item_variations.is_active
       returning id::text`,
      [hotelId, itemId, label, price]);
    if (!rows[0]) return refuse(`${dish[0].name} already has ${label}.`);
    return { ok: true as const, id: rows[0].id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/** Rename and reprice, both sent. */
till.patch("/:code/till/menu/variations/:id", async (c) => {
  const input = await c.req.json<Named>().catch(() => ({}) as Named);
  const label = labelOf(input.label);
  if (!label) return c.json(refuse("A variation needs a name."), 409);
  const price = typedPrice(input.price);
  if (price === null) return c.json(refuse(NO_PRICE), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");

    const { rows: clash } = await client.query<{ is_active: boolean; dish: string }>(
      `select o.is_active, i.name as dish
         from pos_item_variations v
         join pos_item_variations o on o.item_id = v.item_id
                                   and o.label = $3 and o.id <> v.id
         join pos_menu_items i on i.id = v.item_id
        where v.id = $1 and v.hotel_id = $2`,
      [id, hotelId, label]);
    if (clash[0]) {
      return refuse(clash[0].is_active
        ? `${clash[0].dish} already has ${label}.`
        : `${clash[0].dish} had a ${label} that was removed. Add ${label} again `
          + "to bring it back.");
    }

    const { rowCount } = await client.query(
      `update pos_item_variations set label = $3, price = $4
        where id = $1 and hotel_id = $2 and is_active`,
      [id, hotelId, label, price]);
    if (!rowCount) return refuse("No such variation.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/** Removing the LAST variation makes the dish a one-price dish again, and
    its own price has not been looked at since it gained variations. So
    that removal needs the price, typed (the owner, 21 September). */
till.post("/:code/till/menu/variations/:id/remove", async (c) => {
  const input = await c.req.json<{ dishPrice?: unknown }>()
    .catch(() => ({}) as { dishPrice?: unknown });
  const dishPrice = typedPrice(input.dishPrice);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");

    const { rows: v } = await client.query<{
      item_id: string; dish: string; others: string;
    }>(
      `select v.item_id::text, i.name as dish,
              (select count(*) from pos_item_variations o
                where o.item_id = v.item_id and o.is_active
                  and o.id <> v.id)::text as others
         from pos_item_variations v
         join pos_menu_items i on i.id = v.item_id
        where v.id = $1 and v.hotel_id = $2 and v.is_active`,
      [id, hotelId]);
    if (!v[0]) return refuse("No such variation.");

    const last = v[0].others === "0";
    if (last && dishPrice === null) {
      return refuse(`${v[0].dish} will be sold at one price again. What price?`);
    }
    if (last) {
      await client.query(
        `update pos_menu_items set price = $3, updated_at = now()
          where id = $1 and hotel_id = $2`,
        [v[0].item_id, hotelId, dishPrice]);
    }
    await client.query(
      "update pos_item_variations set is_active = false where id = $1", [id]);
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
  const price = typedPrice(input.price);
  if (price === null) return c.json(refuse(NO_PRICE), 409);

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
  const price = typedPrice(input.price);
  if (price === null) return c.json(refuse(NO_PRICE), 409);

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

till.get("/:code/till/rooms", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The same function the bridge uses. A room is chargeable when
       somebody is checked into it AND their folio is open — not merely
       when the room is occupied. Two different questions with two
       different answers on a checkout morning. */
    const { rows } = await client.query<{
      room_number: string; guest_name: string; folio_id: string;
    }>(
      `select room_number, guest_name, folio_id::text
         from app.pos_chargeable_rooms($1)
        order by room_number`,
      [hotelId],
    );

    return {
      rooms: rows.map((r) => ({
        room: r.room_number, guest: r.guest_name, folioId: r.folio_id,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Orders ───────────────────────────────────────────────────────── */

/** One order with its lines and what it comes to. */
async function readOrder(client: Client, orderId: string) {
  const { rows: head } = await client.query<{
    id: string; order_no: string; outlet: string; outlet_name: string;
    hotel_name: string; hotel_city: string | null; hotel_gstin: string | null;
    table_ref: string | null; status: string; business_date: string;
    payment_method: string | null; opened_by_name: string;
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
  }>(
    /* The hotel's details travel WITH the order, the way the invoice
       carries its own. A bill printed today should still read the same
       next year, and a browser assembling it from a live property list
       would quietly reprint it with June's address. */
    `select o.id::text, o.order_no, ou.code as outlet, ou.name as outlet_name,
            h.name as hotel_name, h.city as hotel_city, h.gstin as hotel_gstin,
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
            to_char(o.settled_at,'DD Mon, HH24:MI') as settled_at,
            o.abandoned_reason, o.ticket_id::text,
            o.event_id::text, e.title as event_title
       from pos_orders o
       join pos_outlets ou on ou.id = o.outlet_id
       join hotels h on h.id = o.hotel_id
       left join pos_promotions pr on pr.id = o.promotion_id
       join staff s1 on s1.id = o.opened_by
       left join staff s2 on s2.id = o.settled_by
       left join staff s3 on s3.id = o.waiter_id
       left join banquet_events e on e.id = o.event_id
      where o.id = $1`,
    [orderId],
  );
  if (!head[0]) return null;

  const { rows: lines } = await client.query<{
    id: string; name: string; qty: string; unit_price: string;
    tax_rate: string; tax_scheme: "gst" | "vat"; note: string | null; voided: boolean;
    kot_status: string;
    added_by_name: string;
    parent_line_id: string | null;
    variation_id: string | null; addon_id: string | null;
  }>(
    `select l.id::text, l.name, l.qty::text, l.unit_price::text,
            l.tax_rate::text, l.tax_scheme, l.note, l.voided, l.kot_status,
            s.full_name as added_by_name,
            l.parent_line_id::text, l.variation_id::text, l.addon_id::text
       from pos_order_lines l
       join staff s on s.id = l.added_by
      where l.order_id = $1
      order by l.id`,
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

  /* What was actually taken, and how. One row for an ordinary bill,
     several when the guest paid part cash and part card. Empty while the
     order is open — nothing has been taken yet. */
  const { rows: tenders } = await client.query<{
    id: string; method: string; amount: string;
    tendered: string | null; reference: string | null; taken_by_name: string;
  }>(
    `select t.id::text, t.method, t.amount::text, t.tendered::text,
            t.reference, s.full_name as taken_by_name
       from pos_order_tenders t
       join staff s on s.id = t.taken_by
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
      addedBy: l.added_by_name,
      /* An add-on names the dish it belongs to. The bill and the kitchen
         docket both indent on this: "Sides: Onions" under "Bhaaji Pau
         (Butter)", exactly as the printed ticket does. */
      parentLineId: l.parent_line_id,
      isAddon: l.addon_id !== null,
      variationId: l.variation_id,
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
              to_char(o.opened_at,'HH24:MI') as opened_at,
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

till.post("/:code/till/orders", async (c) => {
  type OpenBody = { outlet?: string; table?: string; tableId?: string };
  const input = await c.req.json<OpenBody>().catch(() => ({}) as OpenBody);
  if (!input.outlet) return c.json(refuse("Which outlet is this order for?"), 409);

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

    if (input.tableId) {
      const { rows: t } = await client.query<{ id: string; label: string }>(
        `select t.id::text, t.label from pos_tables t
           join pos_sections s on s.id = t.section_id
          where t.id = $1 and s.outlet_id = $2 and t.is_active`,
        [input.tableId, outlet[0].id],
      );
      if (!t[0]) return refuse("That table is not in this outlet.");
      tableId = t[0].id;
      tableRef = t[0].label;

      /* Named before the unique index gets to it. Two open orders on one
         table is two bills nobody can tell apart, and the floor would
         show whichever came back first. */
      const { rows: busy } = await client.query<{ order_no: string }>(
        `select order_no from pos_orders
          where table_id = $1 and cleared_at is null and status = 'open'`,
        [tableId],
      );
      if (busy[0]) {
        return refuse(
          `${t[0].label} already has ${busy[0].order_no} running on it.`);
      }
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into pos_orders
         (hotel_id, outlet_id, order_no, table_ref, business_date, opened_by,
          table_id)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id::text`,
      [hotelId, outlet[0].id, no[0]!.order_no, tableRef,
       businessDate, session.staffId, tableId],
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
  addonIds?: string[];
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
  if (!input.itemId) return { ok: false, reason: "Which item?" };


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
                where v.item_id = i.id and v.is_active) as variation_count
         from pos_menu_items i
         join pos_menu_categories c on c.id = i.category_id
        where i.id = $1 and i.hotel_id = $2`,
      [input.itemId, hotelId],
    );
    if (!item[0]) return refuse("No such item on the menu.");
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
        + "missing rate is not zero - a manager can set it under Rooms and rates "
        + "→ Room types, in the GST and VAT card.");
    }
    if (item[0].tax_rate === null) {
      const KIND: Record<string, string> = {
        bar: "the bar", restaurant: "the restaurant",
        banquet: "banqueting", other: "this category",
      };
      return refuse(
        `${item[0].name} has no GST rate. Nothing is set for `
        + `${KIND[item[0].tax_kind] ?? "this category"}, and a missing rate `
        + `is not zero - a manager can set it under Rooms and rates → Room types, in the GST card.`);
    }

    /* THE PRICE COMES FROM THE VARIATION, NOT THE ITEM.

       A dish that gains an Oil and a Butter has a `price` column nobody
       has looked at since. Charging it would put a number on the bill
       that is on no menu — so the database refuses, and this names the
       reason before the constraint does. */
    let name = item[0].name;
    let unitPrice = item[0].price;

    if (Number(item[0].variation_count) > 0) {
      if (!input.variationId) {
        return refuse(`${item[0].name} is sold by variation. Choose one.`);
      }
      const { rows: v } = await client.query<{ label: string; price: string }>(
        `select label, price::text from pos_item_variations
          where id = $1 and item_id = $2 and is_active`,
        [input.variationId, input.itemId],
      );
      if (!v[0]) return refuse("That variation is not on this dish.");
      name = `${item[0].name} (${v[0].label})`;
      unitPrice = v[0].price;
    } else if (input.variationId) {
      return refuse(`${item[0].name} has no variations.`);
    }

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

    /* Price and tax are COPIED onto the line. A menu price that rises
       next month must not silently re-price a bill printed today. */
      /* Increment first. Only if nothing matched does a row get added. */
      /* Add-ons make two lines DIFFERENT even when the dish and note
         match — a Bhaaji Pau with onions is not the same thing to a
         kitchen as one without. Sent with add-ons, it always starts a
         new line rather than joining one whose sides nobody checked. */
      const wantsAddons = (input.addonIds?.length ?? 0) > 0;
      const { rowCount: bumped } = wantsAddons ? { rowCount: 0 } : await client.query(
        `update pos_order_lines
            set qty = qty + $1
          where order_id = $2
            and item_id = $3
            and variation_id is not distinct from $5
            and parent_line_id is null
            and not exists (select 1 from pos_order_lines a
                             where a.parent_line_id = pos_order_lines.id
                               and not a.voided)
            and not voided
            and note is not distinct from $4`,
        [qty, orderId, input.itemId, input.note?.trim() || null,
         input.variationId ?? null],
      );

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
          tax_rate, tax_scheme, note, added_by)
       values ($1,$2,$3,$10,$4,$5,$6,$7,$11,$8,$9)
       returning id`,
      [orderId, hotelId, input.itemId, name, qty,
       unitPrice, item[0].tax_rate, input.note?.trim() || null, session.staffId,
       input.variationId ?? null, item[0].tax_scheme],
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
    }

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

till.post("/:code/till/orders/:id/lines/:lineId/void", async (c) => {
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

    /* Struck, not removed. A waiter adding and cancelling the same
       dish four times is exactly what a manager investigating a
       dispute wants to be able to see. */
    const { rowCount } = await client.query(
      `update pos_order_lines
          set voided = true, voided_by = $1, voided_at = now()
        where id = $2 and order_id = $3 and not voided`,
      [session.staffId, c.req.param("lineId"), orderId],
    );
    if (!rowCount) return refuse("That line is already struck, or is not here.");

    return { ok: true as const, ...(await readOrder(client, orderId))! };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── The discount ─────────────────────────────────────────────────
   A discount is allowed and it must say WHY. A till with nowhere to
   record one does not stop discounts happening — it moves them
   somewhere invisible, and the biller voids a line instead. */

till.post("/:code/till/orders/:id/discount", async (c) => {
  type DiscountBody = { type?: string; value?: number; reason?: string };
  const input = await c.req.json<DiscountBody>().catch(() => ({}) as DiscountBody);

  const type = input.type;
  if (type !== "percent" && type !== "fixed") {
    return c.json(refuse("A discount is a percentage or a fixed amount."), 409);
  }

  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    return c.json(refuse("How much is the discount?"), 409);
  }
  if (type === "percent" && value > 100) {
    return c.json(
      refuse("More than 100% is a refund, not a discount."), 409);
  }

  /* The reason is the whole point. An amount with nobody's explanation
     attached is an unauditable hole in revenue, which is worse than
     not offering the feature at all. */
  const reason = input.reason?.trim();
  if (!reason) {
    return c.json(
      refuse("Why is this discounted? A staff meal, a complaint, a manager's call."),
      409,
    );
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
      minutes: number | null; payable: string | null;
    }>(
      `select section_id::text, section, table_id::text, label, seats,
              row_no, col_no, order_id::text, order_no, state, minutes,
              payable::text
         from app.pos_floor($1)`,
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
        /* blank · running · kot · printed · paid. Derived, so the tile
           cannot disagree with the bill behind it. */
        state: r.state,
        minutes: r.minutes,
        payable: r.payable === null ? null : Number(r.payable),
      });
    }

    return {
      outlet: {
        code, name: outlet[0].name,
        closedUntil: outlet[0].closed_until,
        closedReason: outlet[0].closed_reason,
      },
      sections,
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

    await client.query(
      `update pos_orders set cleared_at = now() where id = $1`, [orderId]);

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
    return c.json(refuse("Dine in, takeaway, room service or delivery."), 409);
  }
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

    const { rows } = await client.query<{ id: string; name: string }>(
      `select s.id::text, s.full_name as name
         from staff s
         join staff_hotels sh on sh.staff_id = s.id
        where sh.hotel_id = $1 and s.is_active
        order by s.full_name`,
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
      recorded_by_name: string; recorded_at: string;
    }>(
      `select m.id::text, m.kind, m.amount::text, m.reason,
              s.full_name as recorded_by_name,
              to_char(m.recorded_at, 'HH24:MI') as recorded_at
         from pos_cash_movements m
         join staff s on s.id = m.recorded_by
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
              d.variance_reason, to_char(d.closed_at, 'DD Mon, HH24:MI') as closed_at,
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

    const denominations = day[0]
      ? (await client.query<{ value: string; count: number }>(
          `select value::text, count from pos_denominations
            where day_end_id = $1 order by value desc`, [day[0].id])).rows
      : [];

    const counted = day[0]?.counted_cash;
    const expectedCash = Number(expected[0]!.amount);

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
      movements: movements.map((m) => ({
        id: m.id, kind: m.kind, amount: Number(m.amount),
        reason: m.reason, recordedBy: m.recorded_by_name, at: m.recorded_at,
      })),
      cash: {
        opening: Number(day[0]?.opening_cash ?? 0),
        expected: expectedCash,
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
      closedAt: day[0]?.closed_at ?? null,
      closedBy: day[0]?.closed_by_name ?? null,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/till/day-end/movements", async (c) => {
  type MoveBody = {
    outlet?: string; kind?: string; amount?: number; reason?: string;
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

    await client.query(
      `insert into pos_cash_movements
         (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [hotelId, outlet[0].id, businessDate, input.kind,
       Number(input.amount).toFixed(2), reason, session.staffId],
    );

    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

till.post("/:code/till/day-end/count", async (c) => {
  type CountBody = {
    outlet?: string; opening?: number;
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

    const { rows: day } = await client.query<{ id: string; closed_at: string | null }>(
      `insert into pos_day_ends
         (hotel_id, outlet_id, business_date, opening_cash)
       values ($1,$2,$3,$4)
       on conflict (outlet_id, business_date) do update
          set opening_cash = coalesce($4, pos_day_ends.opening_cash)
       returning id::text, closed_at::text`,
      [hotelId, outlet[0].id, businessDate,
       input.opening === undefined ? 0 : Number(input.opening).toFixed(2)],
    );
    const dayId = day[0]!.id;

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
  type CloseBody = { outlet?: string; varianceReason?: string };
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

    /* A difference is RECORDED, not refused — but it must say why. The
       money is already whatever it is; what a manager needs tomorrow is
       the sentence, not the number on its own. */
    if (Math.abs(variance) >= 0.01 && !input.varianceReason?.trim()) {
      return refuse(
        `The drawer is ${variance > 0 ? "over" : "short"} by ` +
        `₹${Math.abs(variance).toFixed(2)}. Say why, and it closes.`);
    }

    await client.query(
      `update pos_day_ends
          set variance_reason = $1, closed_by = $2, closed_at = now()
        where id = $3`,
      [input.varianceReason?.trim() || null, session.staffId, day[0].id],
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

  const method = tenders
    ? (tenders.length === 1 ? tenders[0]!.method : "split")
    : input.method;

  if (!method
      || !(METHODS.includes(method) || method === "split" || method === "function")) {
    return c.json(refuse("How was this paid - room, cash, card or upi?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

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
        where o.id = $1 and o.hotel_id = $2`,
      [orderId, hotelId],
    );
    if (!order[0]) return refuse("No such order.");
    if (order[0].status !== "open") {
      return refuse(`This order is already ${order[0].status}.`);
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

    const { rows: t } = await client.query<{
      net: string; discount: string; tax: string;
      gross: string; payable: string;
    }>(`select net::text, discount::text, tax::text, gross::text,
               payable::text from app.pos_order_total($1)`,
      [orderId]);

    const net = Number(t[0]!.net);
    const payable = Number(t[0]!.payable);

    /* An empty bill is not a sale. Settling one would put a zero-value
       ticket on a folio and a zero row in the shift count, which is
       noise somebody has to explain later. */
    if (net <= 0) {
      return refuse(
        "There is nothing on this order. Add an item, or abandon it.",
      );
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

    /* ── Cash, card, upi — and a function: nothing touches a folio ──
       A function's bill is the banquet service's sum, which counts this
       order once it is settled (099). */
    if (method !== "room") {
      await client.query(
        `update pos_orders
            set status='settled', settled_by=$1, settled_at=now(),
                payment_method=$2
          where id = $3`,
        [session.staffId, method, orderId],
      );
      await writeTenders();
      return { ok: true as const, ...(await readOrder(client, orderId))! };
    }

    /* ── To a room: through the bridge, not around it ────────────── */
    const room = input.room?.trim();
    if (!room) return refuse("Which room is this bill for?");

    const { rows: chargeable } = await client.query<{
      folio_id: string; guest_name: string;
    }>(
      `select folio_id::text, guest_name from app.pos_chargeable_rooms($1)
        where room_number = $2`,
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
          folioId: r.folio_id, guest: r.guest_name,
        })),
      };
    }

    const target = candidates[0];
    if (!target) {
      return refuse(
        `Room ${room} cannot be charged: nobody is checked in there, or the ` +
          `folio is closed. Take payment another way.`,
      );
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
              payment_method='room', ticket_id=$2
        where id = $3`,
      /* The first ticket, when a bill split across rates. The order is
         the record of the whole sale; pos_tickets is the record of what
         reached the folio, and a split bill reached it twice. */
      [session.staffId, tickets[0], orderId],
    );

    /* After the ticket exists. The room-tender trigger is deferred so the
       order would not matter, but writing it in the order a person would
       read is worth more than relying on that. */
    await writeTenders();

    return {
      ok: true as const,
      guest: target.guest_name,
      room,
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

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");

    const { rowCount } = await client.query(
      `update pos_orders
          set status='abandoned', abandoned_reason=$1
        where id = $2 and hotel_id = $3 and status = 'open'`,
      [reason, orderId, hotelId],
    );
    if (!rowCount) return refuse("That order is not open.");

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
  type Body = { qty?: number };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

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

    if (qty === 0) {
      /* Down to nothing is a strike, not a delete. A waiter counting to
         zero means the same thing as pressing the cross, and the line
         stays visible either way — 028 keeps struck lines because a
         manager settling a dispute wants to see them. */
      const { rowCount } = await client.query(
        `update pos_order_lines
            set voided = true, voided_by = $1, voided_at = now()
          where id = $2 and order_id = $3 and not voided`,
        [session.staffId, c.req.param("lineId"), orderId],
      );
      if (!rowCount) return refuse("That line is already struck.");
    } else {
      const { rowCount } = await client.query(
        `update pos_order_lines set qty = $1
          where id = $2 and order_id = $3 and not voided`,
        [qty, c.req.param("lineId"), orderId],
      );
      if (!rowCount) return refuse("That line is struck, or is not here.");
    }

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
async function fireKot(
  client: Client, outletId: string, businessDate: string, orderId: string,
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
  };
  const input = await c.req.json<BatchBody>().catch(() => ({}) as BatchBody);

  if (input.eventId !== undefined && input.eventId !== null
      && typeof input.eventId !== "string") {
    return c.json(refuse("Which function is this order for?"), 409);
  }

  const lines = input.lines ?? [];
  if (lines.length === 0) return c.json(refuse("There is nothing to send."), 409);
  if (lines.length > 100) {
    /* Not a real order. A guard against a loop somewhere, not against a
       large table. */
    return c.json(refuse("That is more than a hundred lines."), 409);
  }
  if (!input.outlet && !input.orderId) {
    return c.json(refuse("Which outlet is this order for?"), 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    let orderId = input.orderId ?? null;
    let outletId: string;
    let businessDate: string;
    let opened = false;

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
         input.table?.trim() || null, input.tableId || null,
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
      kot = await fireKot(client, outletId, businessDate, orderId);
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
  const result = await withSession(c.get("subject"), async (client) => {
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
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const orderId = c.req.param("id");
    const kotNo = Number(c.req.param("no"));
    if (!Number.isInteger(kotNo)) return null;

    const { rows: head } = await client.query<{
      order_no: string; table_ref: string | null; order_type: string;
      outlet_name: string; hotel_name: string; sent_at: string | null;
    }>(
      `select o.order_no, o.table_ref, o.order_type,
              ou.name as outlet_name, h.name as hotel_name,
              to_char(min(l.kot_sent_at), 'DD/MM/YY HH24:MI') as sent_at
         from pos_orders o
         join pos_outlets ou on ou.id = o.outlet_id
         join hotels h on h.id = o.hotel_id
         join pos_order_lines l on l.order_id = o.id and l.kot_no = $3
        where o.id = $1 and o.hotel_id = $2
        group by o.order_no, o.table_ref, o.order_type, ou.name, h.name`,
      [orderId, hotelId, kotNo],
    );
    if (!head[0]) return null;

    const { rows } = await client.query<{
      line_id: string; parent_id: string | null; name: string;
      qty: string; note: string | null; is_addon: boolean;
    }>(
      `select line_id::text, parent_id::text, name, qty::text, note, is_addon
         from app.pos_kot($1, $2)`,
      [orderId, kotNo],
    );

    return {
      kotNo,
      orderNo: head[0].order_no,
      table: head[0].table_ref,
      orderType: head[0].order_type,
      outlet: head[0].outlet_name,
      hotel: head[0].hotel_name,
      sentAt: head[0].sent_at,
      lines: rows.map((r) => ({
        id: r.line_id,
        parentId: r.parent_id,
        name: r.name,
        qty: Number(r.qty),
        note: r.note,
        isAddon: r.is_addon,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such docket." }, 404);
});

/* ── The pass ─────────────────────────────────────────────────────────
   Every line the kitchen holds, oldest first. Sorted by when it was
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
      prep_minutes: number | null; at_pass: string | null;
      course: number | null;
    }>(
      `select l.id::text, o.order_no, o.table_ref, o.order_type,
              ou.code as outlet, l.name, l.qty::text, l.note,
              l.kot_status,
              extract(epoch from (now() - l.kot_sent_at))::int::text as waited,
              l.voided, l.was_sent_when_voided,
              /* What this dish SHOULD take, from 079. Null when nobody
                 has timed it - the pass shows a dash, not a zero. */
              app.prep_minutes(l.item_id) as prep_minutes,
              /* HOW LONG IT HAS BEEN SITTING UNDER THE LAMP. Null until
                 it is ready, because a dish still cooking is not late
                 in this sense - it is being made. This is the number
                 that ruins food and the one nothing showed before. */
              case when l.kot_status = 'ready' then
                extract(epoch from (
                  now() - (select ready_at from app.pos_line_timings(l.id))
                ))::int::text
              end as at_pass,
              /* Which course, from the one place that fallback lives.
                 NULL is an unsequenced dish - a drink - and sorts last
                 rather than ahead of the starters. */
              app.course_of(l.item_id) as course
         from pos_order_lines l
         join pos_orders o  on o.id = l.order_id
         join pos_outlets ou on ou.id = o.outlet_id
        where l.hotel_id = $1
          and l.kot_status in ('sent', 'preparing', 'ready')
          and o.status = 'open'
        order by l.kot_sent_at`,
      [hotelId],
    );

    return {
      lines: rows.map((r) => ({
        id: r.id,
        orderNo: r.order_no,
        table: r.table_ref,
        orderType: r.order_type,
        outlet: r.outlet,
        name: r.name,
        qty: Number(r.qty),
        note: r.note,
        status: r.kot_status,
        /* Seconds since it reached the kitchen. The pass sorts and
           colours by this — a dish waiting eleven minutes is the only
           thing on that screen that matters. */
        waitedSeconds: Number(r.waited),
        /* The estimate, and how long it has been at the pass. Both null
           rather than zero when unknown — an untimed dish is not an
           instant one, and a dish still cooking has not been waiting on
           a waiter. */
        prepMinutes: r.prep_minutes,
        atPassSeconds: r.at_pass === null ? null : Number(r.at_pass),
        course: r.course,
        /* A struck line the kitchen already had. Shown so the pass can
           stop cooking it, rather than having the ticket vanish. */
        cancelled: r.voided && r.was_sent_when_voided,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

till.post("/:code/kitchen/lines/:lineId/:to", async (c) => {
  const to = c.req.param("to");
  if (!["preparing", "ready", "served"].includes(to)) {
    return c.json(refuse("A dish moves to preparing, ready or served."), 409);
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
