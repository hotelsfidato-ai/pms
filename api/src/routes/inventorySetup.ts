import { Hono } from "hono";
import { withSession } from "../auth.ts";
import type { PoolClient as Client } from "pg";

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

   A ROOM TYPE IS NOT DELETED. Reservations, rates and folio history
   all point at it, and removing one would either fail on a foreign key
   or orphan a year of bookings. It is deactivated, like everything
   else here — the same rule `hotels_no_delete` enforces one level up.
   ══════════════════════════════════════════════════════════════════ */

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
      "Two to ten letters or digits — it prints on the tape chart and "
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
      "The maximum is at least the number the rate covers — otherwise "
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

  const number = input.number?.trim();
  if (!number) return c.json(refuse("What is the room number?"), 409);
  if (!input.roomTypeId) return c.json(refuse("Which type is it?"), 409);

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
        "Somebody is in that room. Block it instead — a block has dates "
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
  };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);

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
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});



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
        return reject(`"${code}" is not a short code — two to six letters or digits.`);
      }
      if (!name) return reject("No name.");

      const base = num(raw.baseOccupancy);
      const max = num(raw.maxOccupancy);
      if (base === null) return reject("No Sleeps — how many does the tariff cover?");
      if (max === null) return reject("No Maximum — the most the room may hold.");
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

      if (seen.has(code)) return reject(`"${code}" appears twice in this file.`);
      seen.add(code);

      verdicts.push({
        line, name: `${code} · ${name}`,
        action: already.has(code) ? "update" : "create",
        detail: rate === null
          ? "unpriced — shows a dash and cannot be sold"
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
      const number = String(raw.number ?? "").trim();
      const typeCode = String(raw.typeCode ?? "").trim().toUpperCase();
      const reject = (detail: string) => {
        verdicts.push({ line, name: number || "(blank)", action: "rejected", detail });
      };

      if (!number && !typeCode) return;
      if (!number) return reject("No room number.");
      if (!typeCode) return reject("No type code.");

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

/* ══════════════════════════════════════════════════════════════════
   GST, IN ONE PLACE, FOR THE WHOLE PROPERTY

   The front desk and the till used to hold separate answers: the desk
   read `hotels.cgst_rate + sgst_rate` and the till read
   `pos_menu_items.tax_rate default 5.00`. Two places, and a menu that
   silently taxed itself.

   One screen now sets both. A KIND is what is being sold — the room, the
   restaurant, the bar — and a kind may have SLABS, because the rate on a
   room turns on what the room costs. Everything the desk posts follows
   'room'; every menu category names the kind it sells under.

   A kind with no rule cannot be billed. That is deliberate and it is the
   same rule as everywhere else here: a missing number is a dash, and a
   dash is not a zero.
   ══════════════════════════════════════════════════════════════════ */

const TAX_KINDS = ["room", "restaurant", "bar", "banquet", "other"] as const;
type TaxKind = (typeof TAX_KINDS)[number];

inventorySetup.get("/:code/tax", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; kind: string; over_amount: string; rate: string;
      note: string | null; set_by: string | null;
    }>(
      `select t.id::text, t.kind, t.over_amount::text, t.rate::text, t.note,
              s.full_name as set_by
         from tax_rules t
         left join staff s on s.id = t.set_by
        where t.hotel_id = $1
        order by t.kind, t.over_amount`,
      [hotelId]);

    /* Which menu categories sell under which kind, so the screen can say
       "nothing is set for the bar, and these four categories need it". */
    const { rows: cats } = await client.query<{
      name: string; kind: string | null; items: number;
    }>(
      `select c.name, c.tax_kind as kind, count(i.id)::int as items
         from pos_menu_categories c
         left join pos_menu_items i on i.category_id = c.id and i.is_active
        where c.hotel_id = $1 and c.is_active
        group by c.name, c.tax_kind
        order by c.name`,
      [hotelId]);

    const byKind = new Map<string, typeof rows>();
    for (const r of rows) {
      byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    }

    return {
      kinds: TAX_KINDS.map((kind) => ({
        kind,
        slabs: (byKind.get(kind) ?? []).map((r) => ({
          id: r.id,
          overAmount: Number(r.over_amount),
          rate: Number(r.rate),
          note: r.note,
          setBy: r.set_by,
        })),
      })),
      categories: cats.map((x) => ({
        name: x.name, kind: x.kind, items: x.items,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/** Replace every slab for ONE kind, in one call.

    Whole-kind rather than row-by-row on purpose: the slabs of a kind only
    make sense together. Editing them one at a time passes through states
    like "18% above 7,500 and nothing below it", where a ₹4,000 room
    cannot be billed at all — briefly, silently, and in the middle of a
    day the hotel is trading. */
inventorySetup.put("/:code/tax/:kind", async (c) => {
  const kind = c.req.param("kind") as TaxKind;
  if (!TAX_KINDS.includes(kind)) {
    return c.json(refuse(`${kind} is not something this system taxes.`), 409);
  }

  type Slab = { overAmount?: number; rate?: number; note?: string | null };
  const input = await c.req.json<{ slabs?: Slab[] }>()
    .catch(() => ({}) as { slabs?: Slab[] });
  const slabs = input.slabs ?? [];

  for (const s of slabs) {
    if (!Number.isFinite(s.rate) || s.rate! < 0 || s.rate! > 100) {
      return c.json(refuse("A GST rate is a percentage between 0 and 100."), 409);
    }
    if (s.overAmount !== undefined
        && (!Number.isFinite(s.overAmount) || s.overAmount < 0)) {
      return c.json(refuse("A slab starts at zero or more."), 409);
    }
  }

  /* A kind with slabs but no base row has a hole under the lowest one,
     and anything falling in it cannot be billed. Caught here, with the
     reason, rather than discovered by a clerk at the desk. */
  if (slabs.length > 0 && !slabs.some((s) => (s.overAmount ?? 0) === 0)) {
    return c.json(refuse(
      "The first slab has to start at zero, or there is no rate for the "
      + "cheapest rooms. Add a row for everything up to the threshold."), 409);
  }

  const seen = new Set<number>();
  for (const s of slabs) {
    const over = s.overAmount ?? 0;
    if (seen.has(over)) {
      return c.json(refuse(
        `Two slabs both start above ₹${over}. One boundary, one rate.`), 409);
    }
    seen.add(over);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* Deleting a kind's rules is allowed and MEANS SOMETHING: it puts
       that kind back to unset, so it refuses to bill rather than billing
       at nought. Emptying the bar is how you take the bar down. */
    await client.query(
      "delete from tax_rules where hotel_id = $1 and kind = $2",
      [hotelId, kind]);

    for (const s of slabs) {
      await client.query(
        `insert into tax_rules (hotel_id, kind, over_amount, rate, note, set_by)
         values ($1,$2,$3,$4,$5, app.current_user_id())`,
        [hotelId, kind, s.overAmount ?? 0, s.rate, s.note?.trim() || null]);
    }

    return { ok: true as const, slabs: slabs.length };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/** Which tax kind a menu category sells under — the till's half of the
    same screen. A category with no kind cannot be sold, and says so. */
inventorySetup.patch("/:code/menu-categories/:name/tax-kind", async (c) => {
  const input = await c.req.json<{ kind?: string | null }>()
    .catch(() => ({}) as { kind?: string | null });
  const kind = input.kind ?? null;

  if (kind !== null && !TAX_KINDS.includes(kind as TaxKind)) {
    return c.json(refuse(`${kind} is not something this system taxes.`), 409);
  }
  if (kind === "room") {
    return c.json(refuse(
      "A menu category cannot be taxed as a room. Rooms are the front "
      + "desk's; a category sells under the restaurant, the bar or "
      + "banqueting."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rowCount } = await client.query(
      `update pos_menu_categories set tax_kind = $3
        where hotel_id = $1 and name = $2`,
      [hotelId, c.req.param("name"), kind]);

    if (!rowCount) return refuse("No such menu category.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});


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

/* ── What is there now ────────────────────────────────────────────── */

inventorySetup.get("/:code/room-setup", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: types } = await client.query<{
      id: string; code: string; name: string; base: number; max: number;
      sort: number; active: boolean; rate: string | null; rooms: number;
      sellable: number;
    }>(
      `select rt.id::text, rt.code, rt.name,
              rt.base_occupancy as base, rt.max_occupancy as max,
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
      occupied: boolean;
    }>(
      `select r.id::text, r.number, rt.id::text as type_id, rt.name as type,
              r.floor, r.smoking, r.is_active as active,
              r.occupancy_status <> 'vacant' as occupied
         from rooms r join room_types rt on rt.id = r.room_type_id
        where r.hotel_id = $1
        order by r.number`,
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
      })),
      rooms: rooms.map((r) => ({
        id: r.id, number: r.number, roomTypeId: r.type_id, roomType: r.type,
        floor: r.floor, smoking: r.smoking, isActive: r.active,
        occupied: r.occupied,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
