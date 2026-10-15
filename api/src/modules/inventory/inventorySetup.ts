import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";
import { floorProblem, roomNumberProblem } from "../../validate.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTING UP WHAT THE PROPERTY SELLS

   Until this file, nothing in the API could create a room or a room
   type. `app.provision_property` builds a whole property from a
   template in one act, and after that the only way to add a Deluxe or
   a room 308 was SQL.

   That is a real hole in a system meant to run seven hotels: six of
   them are not configured yet, room counts change, a floor gets
   converted. A property manager cannot be told to ask for a database
   session.

   NO PRICE IS SET HERE, and that is deliberate rather than an
   omission. `base_rate` stays NULL on a new room type — the rack rate
   is set on the rate calendar, by somebody who has decided what the
   room is worth. Defect 63 is the system shipping prices nobody at the
   hotel had chosen, and a "create room type" form with a rate field
   pre-filled at 3500 is the same fault wearing a different hat.

   A ROOM TYPE IN USE IS NOT DELETED. Reservations, rates and folio
   history point at it, and removing one would either fail on a foreign
   key or orphan a year of bookings. It is switched Off. One that nothing
   uses - no room, booking, price or difference - may be Removed (the
   owner, D27-263: a new hotel starts empty and types are added by hand).
   ══════════════════════════════════════════════════════════════════ */

/* Split by service on 15 September (docs/SERVICE-FOLDERS-PLAN.md); this
   is the inventory part. GST — the tax rules and a menu category's tax
   kind — is in modules/finance/tax.ts, and "what this property still
   needs" in modules/admin/commissioning.ts. No endpoint changed. */

export const inventorySetup = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/* ── Room types ───────────────────────────────────────────────────── */

inventorySetup.post("/:code/room-types", async (c) => {
  type Body = {
    code?: string; name?: string;
    baseOccupancy?: number; maxOccupancy?: number; sortOrder?: number;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const code = input.code?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!code) return c.json(refuse("A short code, like DLX."), 409);
  if (!/^[A-Z0-9]{2,10}$/.test(code)) {
    return c.json(refuse(
      "Two to ten letters or digits - it prints on the tape chart and "
      + "the rate grid, where there is no room for a sentence."), 409);
  }
  if (!name) return c.json(refuse("What is this type called?"), 409);

  const base = Number(input.baseOccupancy ?? 2);
  const max = Number(input.maxOccupancy ?? 3);
  if (!Number.isInteger(base) || base < 1) {
    return c.json(refuse("How many people does the rate cover?"), 409);
  }
  if (!Number.isInteger(max) || max < base) {
    return c.json(refuse(
      "The maximum is at least the number the rate covers - otherwise "
      + "an extra person costs less than nobody."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into room_types
           (hotel_id, code, name, base_occupancy, max_occupancy, sort_order)
         values ($1,$2,$3,$4,$5,$6)
         returning id::text`,
        /* base_rate is NOT in this list. A new type is UNPRICED until
           somebody sets a rate on the calendar. */
        [hotelId, code, name, base, max, input.sortOrder ?? 0]);
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      const e = error as { code?: string; message?: string } | undefined;
      if (e?.code === "23505") {
        return refuse(`This property already has a type coded ${code}.`);
      }
      return refuse(e?.message ?? "That room type could not be added.");
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

inventorySetup.patch("/:code/room-types/:id", async (c) => {
  type Body = {
    name?: string; baseOccupancy?: number; maxOccupancy?: number;
    sortOrder?: number; isActive?: boolean;
    /* The Settings console's room type (D27-258): null clears each. */
    baseChildren?: number; maxAdults?: number | null; maxChildren?: number | null;
    beds?: string | null; viewType?: string | null; sizeSqft?: number | null;
    colour?: string | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: cur } = await client.query<{
      base_occupancy: number; max_occupancy: number;
    }>(
      `select base_occupancy, max_occupancy from room_types
        where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId]);
    if (!cur[0]) return "missing" as const;

    const base = input.baseOccupancy ?? cur[0].base_occupancy;
    const max = input.maxOccupancy ?? cur[0].max_occupancy;
    if (max < base) {
      return refuse("The maximum is at least the number the rate covers.");
    }

    /* DEACTIVATING IS NOT DELETING, and it is refused while rooms are
       still of this type — otherwise the tape chart shows rooms whose
       type is switched off, and nothing explains why they cannot be
       sold. Move the rooms first. */
    if (input.isActive === false) {
      const { rows: still } = await client.query<{ n: string }>(
        `select count(*)::text as n from rooms
          where room_type_id = $1 and is_active`, [c.req.param("id")]);
      if (Number(still[0]!.n) > 0) {
        return refuse(
          `${still[0]!.n} room${Number(still[0]!.n) === 1 ? " is" : "s are"} `
          + "still of this type. Move them to another type first.");
      }
    }

    await client.query(
      `update room_types set
         name = coalesce($3, name),
         base_occupancy = $4, max_occupancy = $5,
         sort_order = coalesce($6, sort_order),
         is_active = coalesce($7, is_active)
       where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId, input.name?.trim() || null,
       base, max, input.sortOrder ?? null, input.isActive ?? null]);

    /* Each one only when sent; the database keeps them fitting each other
       (room_types_people_fit, room_types_words_fit). */
    const MORE: [keyof Body, string, (v: unknown) => unknown][] = [
      ["baseChildren", "base_children", (v) => v],
      ["maxAdults", "max_adults", (v) => v],
      ["maxChildren", "max_children", (v) => v],
      ["beds", "beds", (v) => (typeof v === "string" ? v.trim() || null : null)],
      ["viewType", "view_type", (v) => (typeof v === "string" ? v.trim() || null : null)],
      ["sizeSqft", "size_sqft", (v) => v],
      ["colour", "colour", (v) => (typeof v === "string" ? v.toLowerCase() || null : null)],
    ];
    const sent = MORE.filter(([key]) => Object.hasOwn(input, key));
    if (sent.length > 0) {
      try {
        await client.query("savepoint fit");
        await client.query(
          `update room_types set ${sent.map(([, col], i) => `${col} = $${i + 3}`).join(", ")}
            where id = $1 and hotel_id = $2`,
          [c.req.param("id"), hotelId, ...sent.map(([key, , clean]) => clean(input[key]) ?? null)]);
      } catch (error) {
        await client.query("rollback to savepoint fit");
        const e = error as { code?: string; constraint?: string };
        if (e.code === "23514" && e.constraint === "room_types_people_fit") {
          return refuse("Adults and children must fit the total: children fewer than the "
            + "total, and the base guests within it.");
        }
        if (e.code === "23514" || e.code === "22P02") {
          return refuse("Beds and view up to 60 letters, a size in square feet, a colour like #1f6f5c.");
        }
        throw error;
      }
    }
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such room type." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

inventorySetup.delete("/:code/room-types/:id", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const id = c.req.param("id");
    const { rows } = await client.query<{ found: boolean; uses: string | null }>(
      `select exists (select 1 from room_types where id = $1 and hotel_id = $2) as found,
              case
                when exists (select 1 from rooms where room_type_id = $1) then 'rooms'
                when exists (select 1 from reservations where room_type_id = $1) then 'bookings'
                when exists (select 1 from rates where room_type_id = $1) then 'prices'
                when exists (select 1 from rate_offsets where room_type_id = $1) then 'a difference from the base'
                when exists (select 1 from pricing_basis where room_type_id = $1) then 'the base for the other types'
              end as uses`, [id, hotelId]);
    if (!rows[0]!.found) return "missing" as const;
    if (rows[0]!.uses) {
      return refuse(`This room type has ${rows[0]!.uses}, so it cannot be removed. Switch it Off instead.`);
    }
    try {
      await client.query("savepoint gone");
      await client.query("delete from room_types where id = $1 and hotel_id = $2", [id, hotelId]);
    } catch (error) {
      await client.query("rollback to savepoint gone");
      if ((error as { code?: string }).code === "23503") {
        return refuse("Something still uses this room type, so it cannot be removed. Switch it Off instead.");
      }
      throw error;
    }
    return { ok: true as const };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such room type." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Rooms ────────────────────────────────────────────────────────── */

inventorySetup.post("/:code/rooms", async (c) => {
  type Body = {
    number?: string; roomTypeId?: string; floor?: number | null;
    smoking?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

  /* Always in capitals (D27-335): 111a is saved 111A, so it can never be a
     second room beside 111A. */
  const number = input.number?.trim().toUpperCase();
  if (!number) return c.json(refuse("What is the room number?"), 409);
  if (!input.roomTypeId) return c.json(refuse("Which type is it?"), 409);
  /* RT-4 (the owner, 28 September): a 60-character number and floor -5 were
     added, sellable at once, and a room cannot be deleted afterwards. */
  const typed = roomNumberProblem(number) ?? floorProblem(input.floor);
  if (typed) return c.json(refuse(typed), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* The type must belong to THIS property. RLS scopes what a session
       can see, and a group admin sees every hotel — so without this a
       room at Akkalkot could be given a Pune room type and every rate
       lookup would quietly miss. The same guard 060 gives banquet. */
    const { rows: type } = await client.query<{ id: string; active: boolean }>(
      `select id::text, is_active as active from room_types
        where id = $1 and hotel_id = $2`, [input.roomTypeId, hotelId]);
    if (!type[0]) return refuse("That room type is not at this property.");
    if (!type[0].active) {
      return refuse("That room type is switched off. Turn it back on first.");
    }

    const { rows: clash } = await client.query<{ n: string }>(
      `select count(*)::text as n from rooms
        where hotel_id = $1 and number = $2`, [hotelId, number]);
    if (Number(clash[0]!.n) > 0) {
      return refuse(`This property already has a room ${number}.`);
    }

    const { rows } = await client.query<{ id: string }>(
      `insert into rooms (hotel_id, room_type_id, number, floor, smoking)
       values ($1,$2,$3,$4,$5) returning id::text`,
      [hotelId, input.roomTypeId, number,
       input.floor ?? null, input.smoking ?? false]);
    return { ok: true as const, id: rows[0]!.id };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

inventorySetup.patch("/:code/rooms/:number", async (c) => {
  type Body = {
    roomTypeId?: string; floor?: number | null; smoking?: boolean;
    isActive?: boolean;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const badFloor = floorProblem(input.floor);   /* RT-4 */
  if (badFloor) return c.json(refuse(badFloor), 409);

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: room } = await client.query<{ id: string; occupied: boolean }>(
      `select id::text, occupancy_status <> 'vacant' as occupied
         from rooms where hotel_id = $1 and number = $2`,
      [hotelId, c.req.param("number")]);
    if (!room[0]) return "missing" as const;

    if (input.roomTypeId) {
      const { rows: type } = await client.query<{ id: string }>(
        `select id::text from room_types where id = $1 and hotel_id = $2`,
        [input.roomTypeId, hotelId]);
      if (!type[0]) return refuse("That room type is not at this property.");
    }

    /* A ROOM WITH SOMEBODY IN IT IS NOT RETIRED. The guest is standing
       in it, the folio is open, and the night audit has to charge for
       it. Take it out of service through a block, which is dated and
       has a reason — that is what 022 built blocks for. */
    if (input.isActive === false && room[0].occupied) {
      return refuse(
        "Somebody is in that room. Block it instead - a block has dates "
        + "and a reason, and this does not.");
    }

    await client.query(
      `update rooms set
         room_type_id = coalesce($3, room_type_id),
         floor = case when $4::boolean then $5::smallint else floor end,
         smoking = coalesce($6, smoking),
         is_active = coalesce($7, is_active)
       where hotel_id = $1 and number = $2`,
      [hotelId, c.req.param("number"), input.roomTypeId ?? null,
       Object.hasOwn(input, "floor"), input.floor ?? null,
       input.smoking ?? null, input.isActive ?? null]);
    return { ok: true as const };
  });

  if (result === null) return c.json({ error: "No such property." }, 404);
  if (result === "missing") return c.json({ error: "No such room." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


/* Rooms in the order the owner drags them (D27-258). */
inventorySetup.put("/:code/rooms/order", async (c) => {
  const input = await c.req.json<{ numbers?: unknown }>().catch(() => ({}) as { numbers?: unknown });
  const numbers = Array.isArray(input.numbers) && input.numbers.every((n) => typeof n === "string")
    ? (input.numbers as string[]) : null;
  if (!numbers || numbers.length === 0 || numbers.length > 1000) {
    return c.json(refuse("Send the room numbers in their new order."), 409);
  }
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    await client.query(
      `update rooms r set position = o.n
         from unnest($2::text[]) with ordinality o(number, n)
        where r.hotel_id = $1 and r.number = o.number`, [hotelId, numbers]);
    return { ok: true as const };
  });
  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result);
});

/* ── The property's own clock and its exception charges ───────────
   063 gave the system an opinion about the hour a guest arrives, and
   nothing could set it. Check-in time, check-out time and both charges
   were reachable only through a database session — which makes the
   whole feature unusable by the people it is for, and is the same hole
   room types had this morning.

   NO CHARGE IS INVENTED. Sending null clears one, and a cleared charge
   means "we do not charge for this" — a real and common answer, and
   not the same as charging zero. */
inventorySetup.patch("/:code/front-desk", async (c) => {
  type Body = {
    checkInTime?: string; checkOutTime?: string;
    earlyCheckinCharge?: number | null;
    lateCheckoutCharge?: number | null;
    /* The front desk's rules (187, the owner's D27-243): absent = unchanged. */
    defaultPaymentMethod?: string;
    deskMayOverbook?: boolean;
    advanceBeforeCheckIn?: string;
    weekendDays?: number[];
    defaultIdType?: string | null;
    defaultNationality?: string;
    defaultTitle?: string | null;
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const rule = rulesProblem(input);
  if (rule) return c.json(refuse(rule), 409);

  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const [label, value] of [
    ["Check-in time", input.checkInTime],
    ["Check-out time", input.checkOutTime],
  ] as const) {
    if (value !== undefined && !clock.test(value)) {
      return c.json(refuse(`${label} is a 24-hour time, like 13:00.`), 409);
    }
  }
  for (const [label, value] of [
    ["The early arrival charge", input.earlyCheckinCharge],
    ["The late departure charge", input.lateCheckoutCharge],
  ] as const) {
    if (value !== undefined && value !== null
        && (!Number.isFinite(value) || value < 0)) {
      return c.json(refuse(`${label} is zero or more, or blank for none.`), 409);
    }
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    await client.query(
      `update hotels set
         check_in_time  = coalesce($2::time, check_in_time),
         check_out_time = coalesce($3::time, check_out_time),
         early_checkin_charge = case when $4::boolean
           then $5::numeric else early_checkin_charge end,
         late_checkout_charge = case when $6::boolean
           then $7::numeric else late_checkout_charge end
       where id = $1`,
      [hotelId,
       input.checkInTime ?? null, input.checkOutTime ?? null,
       Object.hasOwn(input, "earlyCheckinCharge"), input.earlyCheckinCharge ?? null,
       Object.hasOwn(input, "lateCheckoutCharge"), input.lateCheckoutCharge ?? null]);
    await client.query(
      `update hotels set
         default_payment_method  = coalesce($2, default_payment_method),
         desk_may_overbook       = coalesce($3, desk_may_overbook),
         advance_before_check_in = coalesce($4, advance_before_check_in),
         weekend_days            = coalesce($5::smallint[], weekend_days),
         default_id_type = case when $6::boolean then $7 else default_id_type end,
         default_nationality     = coalesce($8, default_nationality),
         default_title   = case when $9::boolean then $10 else default_title end
       where id = $1`,
      [hotelId, input.defaultPaymentMethod ?? null, input.deskMayOverbook ?? null,
       input.advanceBeforeCheckIn ?? null, input.weekendDays ?? null,
       Object.hasOwn(input, "defaultIdType"), input.defaultIdType || null,
       input.defaultNationality?.trim().toUpperCase() ?? null,
       Object.hasOwn(input, "defaultTitle"), input.defaultTitle || null]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});



/* The front desk's rules, refused in a sentence before anything is written
   (187 refuses them again). */
function rulesProblem(input: {
  defaultPaymentMethod?: string; deskMayOverbook?: boolean; advanceBeforeCheckIn?: string;
  weekendDays?: number[]; defaultIdType?: string | null; defaultNationality?: string;
  defaultTitle?: string | null;
}): string | null {
  const one = (v: unknown, of: readonly unknown[]) => v === undefined || of.includes(v);
  if (!one(input.defaultPaymentMethod, ["Cash", "UPI", "Credit Card", "Debit Card"])) {
    return "The default way of paying is Cash, UPI, Credit Card or Debit Card.";
  }
  if (input.deskMayOverbook !== undefined && typeof input.deskMayOverbook !== "boolean") {
    return "Whether the desk may overbook is a yes or a no.";
  }
  if (!one(input.advanceBeforeCheckIn, ["none", "first_night", "whole_stay"])) {
    return "The advance before check-in is none, the first night or the whole stay.";
  }
  if (input.weekendDays !== undefined && !(Array.isArray(input.weekendDays)
      && input.weekendDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) {
    return "Weekend days are days of the week, Sunday to Saturday.";
  }
  if (!one(input.defaultIdType || null, [null, "aadhaar", "passport", "driving_licence", "voter", "other"])) {
    return "The default ID is Aadhaar, Passport, Driving licence, Voter ID, Other, or none.";
  }
  if (input.defaultNationality !== undefined && !/^[A-Za-z]{2}$/.test(input.defaultNationality.trim())) {
    return "The default nationality is two letters, IN for India.";
  }
  if (!one(input.defaultTitle || null, [null, "Mr", "Ms", "Mrs", "Dr"])) {
    return "The default title is Mr, Ms, Mrs, Dr, or none.";
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   ROOM TYPES AND ROOMS, FROM A FILE

   A new property needs eighteen rooms before it can sell one, and
   eighteen visits to a dialog is how somebody gives up halfway and
   leaves a house half-entered. Same shape as the menu import: a dry run
   that changes nothing, then the same payload to apply.

   THE TARIFF IS THE ONE FIELD THAT MAY BE BLANK. A room type with no
   price is UNPRICED — it shows a dash and cannot be sold — and that is
   a legitimate state to import, because somebody may know their room
   list before they have agreed a rate. Every other required field
   rejects the row rather than being filled in.

   A ROOM'S TYPE MUST ALREADY EXIST. Creating one implicitly from a
   three-letter code in a spreadsheet is how a typo becomes a room type
   called "SUPP" holding one room that nobody can find.
   ══════════════════════════════════════════════════════════════════ */

interface SetupVerdict {
  line: number;
  name: string;
  action: "create" | "update" | "rejected";
  detail: string;
}

const num = (v: unknown): number | null => {
  const t = String(v ?? "").trim().replace(/[,\s₹]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

inventorySetup.post("/:code/room-types/import", async (c) => {
  type Row = {
    code?: string; name?: string; baseOccupancy?: string;
    maxOccupancy?: string; rate?: string;
    extraAdult?: string; extraChild?: string;
  };
  const input = await c.req.json<{ rows?: Row[]; dryRun?: boolean }>()
    .catch(() => ({}) as { rows?: Row[]; dryRun?: boolean });

  const rows = input.rows ?? [];
  const dryRun = input.dryRun !== false;
  if (rows.length === 0) {
    return c.json(refuse("There are no rows in that file."), 409);
  }
  if (rows.length > 200) {
    return c.json(refuse(
      `That file has ${rows.length} rows. A property with two hundred room `
      + "types is almost certainly a rooms file in the wrong place."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: have } = await client.query<{ code: string }>(
      "select code from room_types where hotel_id = $1", [hotelId]);
    const already = new Set(have.map((r) => r.code.toUpperCase()));

    const verdicts: SetupVerdict[] = [];
    const seen = new Set<string>();
    const good: {
      code: string; name: string; base: number; max: number;
      rate: number | null; extraAdult: number | null; extraChild: number | null;
    }[] = [];

    rows.forEach((raw, i) => {
      const line = i + 2;
      const code = String(raw.code ?? "").trim().toUpperCase();
      const name = String(raw.name ?? "").trim();
      const reject = (detail: string) => {
        verdicts.push({ line, name: code || name || "(blank)", action: "rejected", detail });
      };

      if (!code && !name) return;
      if (!code) return reject("No code.");
      if (!/^[A-Z0-9]{2,6}$/.test(code)) {
        return reject(`"${code}" is not a short code - two to six letters or digits.`);
      }
      if (!name) return reject("No name.");

      const base = num(raw.baseOccupancy);
      const max = num(raw.maxOccupancy);
      if (base === null) return reject("No Sleeps - how many does the tariff cover?");
      if (max === null) return reject("No Maximum - the most the room may hold.");
      if (Number.isNaN(base) || Number.isNaN(max) || base < 1 || max < 1) {
        return reject("Sleeps and Maximum are whole numbers of people.");
      }
      if (max < base) return reject(`Maximum ${max} is fewer than Sleeps ${base}.`);

      /* THE ONE FIELD THAT MAY BE BLANK. Unpriced is a real state and
         the screens already show it as a dash. */
      const rate = num(raw.rate);
      if (rate !== null && (Number.isNaN(rate) || rate < 0)) {
        return reject(`"${raw.rate}" is not a tariff.`);
      }
      const extraAdult = num(raw.extraAdult);
      const extraChild = num(raw.extraChild);
      if ((extraAdult !== null && Number.isNaN(extraAdult))
          || (extraChild !== null && Number.isNaN(extraChild))) {
        return reject("An extra-person rate must be a number, or blank.");
      }
      /* X-1 (D27-120): 0 only when ticked Free, and a file has no tick.
         Leave it blank, and mark a free one on Rate plans or the calendar. */
      if (rate === 0 || extraAdult === 0 || extraChild === 0) {
        return reject("0 is not taken from a file. Leave it blank if nobody has priced it; "
          + "tick Free on the screen for one that costs nothing.");
      }

      if (seen.has(code)) return reject(`"${code}" appears twice in this file.`);
      seen.add(code);

      verdicts.push({
        line, name: `${code} · ${name}`,
        action: already.has(code) ? "update" : "create",
        detail: rate === null
          ? "unpriced - shows a dash and cannot be sold"
          : `sleeps ${base}, up to ${max}, ${rate}`,
      });
      good.push({ code, name, base, max, rate, extraAdult, extraChild });
    });

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: verdicts.filter((v) => v.action === "update").length,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };
    if (dryRun) return { ok: true as const, dryRun: true, verdicts, ...tally };

    for (const t of good) {
      await client.query(
        `insert into room_types
           (hotel_id, code, name, base_occupancy, max_occupancy,
            base_rate, extra_adult_rate, extra_child_rate)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (hotel_id, code) do update
           set name             = excluded.name,
               base_occupancy   = excluded.base_occupancy,
               max_occupancy    = excluded.max_occupancy,
               base_rate        = excluded.base_rate,
               extra_adult_rate = excluded.extra_adult_rate,
               extra_child_rate = excluded.extra_child_rate,
               is_active        = true`,
        [hotelId, t.code, t.name, t.base, t.max, t.rate,
         t.extraAdult, t.extraChild],
      );
    }

    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

inventorySetup.post("/:code/rooms/import", async (c) => {
  type Row = {
    number?: string; typeCode?: string; floor?: string; smoking?: string;
  };
  const input = await c.req.json<{ rows?: Row[]; dryRun?: boolean }>()
    .catch(() => ({}) as { rows?: Row[]; dryRun?: boolean });

  const rows = input.rows ?? [];
  const dryRun = input.dryRun !== false;
  if (rows.length === 0) {
    return c.json(refuse("There are no rows in that file."), 409);
  }
  if (rows.length > 1000) {
    return c.json(refuse(
      `That file has ${rows.length} rows. A thousand is the limit.`), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: types } = await client.query<{ id: string; code: string }>(
      "select id::text, code from room_types where hotel_id = $1", [hotelId]);
    const typeByCode = new Map(types.map((t) => [t.code.toUpperCase(), t.id]));

    const { rows: have } = await client.query<{ number: string }>(
      "select number from rooms where hotel_id = $1", [hotelId]);
    const already = new Set(have.map((r) => r.number));

    const verdicts: SetupVerdict[] = [];
    const seen = new Set<string>();
    const good: {
      number: string; typeId: string; floor: number | null; smoking: boolean;
    }[] = [];

    rows.forEach((raw, i) => {
      const line = i + 2;
      const number = String(raw.number ?? "").trim().toUpperCase();   /* D27-335 */
      const typeCode = String(raw.typeCode ?? "").trim().toUpperCase();
      const reject = (detail: string) => {
        verdicts.push({ line, name: number || "(blank)", action: "rejected", detail });
      };

      if (!number && !typeCode) return;
      if (!number) return reject("No room number.");
      if (!typeCode) return reject("No type code.");
      const badNumber = roomNumberProblem(number);   /* RT-4 */
      if (badNumber) return reject(badNumber);

      /* THE TYPE MUST ALREADY EXIST. Creating one implicitly from a
         three-letter code is how a typo becomes a room type called
         "SUPP" holding one room nobody can find. */
      const typeId = typeByCode.get(typeCode);
      if (!typeId) {
        return reject(
          `There is no room type "${typeCode}" at this property. `
          + (types.length > 0
              ? `It has ${types.map((t) => t.code).join(", ")}.`
              : "Add the room types first."));
      }

      const floor = num(raw.floor);
      if (floor !== null && Number.isNaN(floor)) {
        return reject(`"${raw.floor}" is not a floor.`);
      }
      const badFloor = floorProblem(floor);   /* RT-4 */
      if (badFloor) return reject(badFloor);

      const smokingRaw = String(raw.smoking ?? "").trim().toLowerCase();
      let smoking = false;
      if (smokingRaw !== "") {
        if (["yes", "y", "true", "1"].includes(smokingRaw)) smoking = true;
        else if (!["no", "n", "false", "0"].includes(smokingRaw)) {
          return reject(`"${raw.smoking}" is not yes or no.`);
        }
      }

      if (seen.has(number)) return reject(`Room ${number} appears twice in this file.`);
      seen.add(number);

      verdicts.push({
        line, name: number,
        action: already.has(number) ? "update" : "create",
        detail: `${typeCode}${floor === null ? "" : ` · floor ${floor}`}`,
      });
      good.push({ number, typeId, floor, smoking });
    });

    const tally = {
      creates: verdicts.filter((v) => v.action === "create").length,
      updates: verdicts.filter((v) => v.action === "update").length,
      rejected: verdicts.filter((v) => v.action === "rejected").length,
    };
    if (dryRun) return { ok: true as const, dryRun: true, verdicts, ...tally };

    for (const r of good) {
      await client.query(
        `insert into rooms (hotel_id, room_type_id, number, floor, smoking)
         values ($1,$2,$3,$4,$5)
         on conflict (hotel_id, number) do update
           set room_type_id = excluded.room_type_id,
               floor        = excluded.floor,
               smoking      = excluded.smoking,
               is_active    = true`,
        [hotelId, r.typeId, r.number, r.floor, r.smoking],
      );
    }

    return { ok: true as const, dryRun: false, verdicts, ...tally };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── What is there now ────────────────────────────────────────────── */

inventorySetup.get("/:code/room-setup", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: types } = await client.query<{
      id: string; code: string; name: string; base: number; max: number;
      sort: number; active: boolean; rate: string | null; rooms: number;
      sellable: number; base_children: number; max_adults: number | null;
      max_children: number | null; beds: string | null; view_type: string | null;
      size_sqft: number | null; colour: string | null;
    }>(
      `select rt.id::text, rt.code, rt.name,
              rt.base_occupancy as base, rt.max_occupancy as max,
              rt.base_children, rt.max_adults, rt.max_children, rt.beds,
              rt.view_type, rt.size_sqft, rt.colour,
              rt.sort_order as sort, rt.is_active as active,
              rt.base_rate::text as rate,
              count(r.id)::int as rooms,
              count(r.id) filter (where r.is_active)::int as sellable
         from room_types rt
         left join rooms r on r.room_type_id = rt.id
        where rt.hotel_id = $1
        group by rt.id
        order by rt.sort_order, rt.code`,
      [hotelId]);

    const { rows: rooms } = await client.query<{
      id: string; number: string; type_id: string; type: string;
      floor: number | null; smoking: boolean; active: boolean;
      occupied: boolean; position: number;
    }>(
      `select r.id::text, r.number, rt.id::text as type_id, rt.name as type,
              r.floor, r.smoking, r.is_active as active,
              r.occupancy_status <> 'vacant' as occupied, r.position
         from rooms r join room_types rt on rt.id = r.room_type_id
        where r.hotel_id = $1
        order by r.position, r.number`,
      [hotelId]);

    const { rows: h } = await client.query<{
      cin: string; cout: string; early: string | null; late: string | null;
    }>(
      `select to_char(check_in_time,'HH24:MI') as cin,
              to_char(check_out_time,'HH24:MI') as cout,
              early_checkin_charge::text as early,
              late_checkout_charge::text as late
         from hotels where id = $1`, [hotelId]);

    return {
      frontDesk: {
        checkInTime: h[0]!.cin,
        checkOutTime: h[0]!.cout,
        /* NULL, never 0. "We do not charge" is a decision; zero is a
           price, and the screens show a dash for the first. */
        earlyCheckinCharge: h[0]!.early === null ? null : Number(h[0]!.early),
        lateCheckoutCharge: h[0]!.late === null ? null : Number(h[0]!.late),
      },
      types: types.map((t) => ({
        id: t.id, code: t.code, name: t.name,
        baseOccupancy: t.base, maxOccupancy: t.max, sortOrder: t.sort,
        isActive: t.active,
        /* NULL, not 0. An unpriced type is not a free one, and this is
           the seventh place that rule is enforced. */
        rackRate: t.rate === null ? null : Number(t.rate),
        rooms: t.rooms, sellable: t.sellable,
        baseChildren: t.base_children, maxAdults: t.max_adults, maxChildren: t.max_children,
        beds: t.beds, viewType: t.view_type, sizeSqft: t.size_sqft, colour: t.colour,
      })),
      rooms: rooms.map((r) => ({
        id: r.id, number: r.number, roomTypeId: r.type_id, roomType: r.type,
        floor: r.floor, smoking: r.smoking, isActive: r.active,
        occupied: r.occupied, position: r.position,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
