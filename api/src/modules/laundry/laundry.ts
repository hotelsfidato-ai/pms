import { Hono } from "hono";
import type { Context, Next } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor, resolveDate } from "../../businessDate.ts";
import { postCharge } from "../finance/index.ts";
import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   THE LAUNDRY

   One place for everything that goes to the laundry - a guest's bag and
   the hotel's own linen - behind the per-hotel switch the master wrote
   (D17-54, migration 115). Reception and housekeeping run it; there are
   no new roles (D18-8).

   THE THREE RULES THIS FILE KEEPS, and the database keeps under it:

     NOTHING IS PRICED. A property's list starts empty and a line may
       have no price at all. It answers `null`, the screen draws a dash,
       and a bag carrying it has no total - not a part-total.
     WHOSE IT IS IS REQUIRED (D18-5). `belongs_to` is a column on every
       docket. A guest's names the stay; the hotel's own cannot be charged.
     A TIME BELONGS TO ITS PROPERTY (113). Every moment is written through
       `app.hotel_moment` and read back through `app.hotel_clock`. The
       server runs in GMT and the API suite in UTC; Akkalkot is in neither.

   AND THE CHARGE IS NOT WRITTEN HERE. A guest's docket reaches the bill
   through finance's front door, never by this file inserting into
   `folio_postings` - see the note above `charge` at the foot.
   ══════════════════════════════════════════════════════════════════ */

export const laundry = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── The module gate ──────────────────────────────────────────────
   HIDING A SCREEN IS NOT DISABLING IT. The navigation stops showing
   laundry at a property that has not switched it on, and these routes
   refuse it independently - because a hidden screen whose endpoint
   still answers is a screen anybody can reach by typing the URL. */
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
      `select app.module_enabled($1, 'laundry') as enabled`, [hotelId]);
    return rows[0]!.enabled;
  });

  if (allowed === null) return c.json({ error: "No such property." }, 404);
  if (!allowed) {
    return c.json(refuse(
      "This property does not run a laundry. Turn it on in the property's "
      + "settings if that is wrong."), 403);
  }
  await next();
}

laundry.use("/:code/laundry", moduleGate);
laundry.use("/:code/laundry/*", moduleGate);


const SERVICES = ["wash", "press", "dry_clean"];

/** What a person typed, as a number, or null. Never a silent 0. */
function priceOf(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}


/* ══════════════════════════════════════════════════════════════════
   THE PRICE LIST
   ══════════════════════════════════════════════════════════════════ */

laundry.get("/:code/laundry/price-list", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; name: string; service: string;
      price: string | null; is_active: boolean;
    }>(
      `select id::text, name, service, price::text, is_active
         from laundry_price_items
        where hotel_id = $1
        order by lower(btrim(name)), service`,
      [hotelId],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        service: r.service,
        /* NULL stays null all the way to the screen, which draws a dash.
           It is never coerced to 0 anywhere on this path. */
        price: r.price === null ? null : Number(r.price),
        isActive: r.is_active,
      })),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

laundry.post("/:code/laundry/price-list", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as {
    name?: string; service?: string; price?: unknown;
  };

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const name = input.name?.trim();
    if (!name) return refuse("An item needs a name.");
    if (!input.service || !SERVICES.includes(input.service)) {
      return refuse("Choose wash, press or dry-clean.");
    }

    const price = priceOf(input.price ?? null);
    if (price === undefined) return refuse("That price is not a number.");

    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into laundry_price_items (hotel_id, name, service, price, created_by)
         values ($1, $2, $3, $4, app.current_user_id())
         returning id::text`,
        [hotelId, name, input.service, price],
      );
      return { ok: true as const, data: { id: rows[0]!.id } };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return refuse(`${name} is already on the list for that service.`);
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* Set a price, or retire a line. Retiring is not deleting: a docket
   already written keeps its own copy of the description and the price. */
laundry.post("/:code/laundry/price-list/:id", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as {
    price?: unknown; isActive?: boolean;
  };

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const price = priceOf(input.price);
    if (price === undefined && input.price !== undefined) {
      return refuse("That price is not a number.");
    }

    const { rows } = await client.query<{ id: string }>(
      `update laundry_price_items
          set price     = case when $3::boolean then $4::numeric else price end,
              is_active = coalesce($5::boolean, is_active)
        where hotel_id = $1 and id = $2::uuid
        returning id::text`,
      [hotelId, c.req.param("id"),
       input.price !== undefined, price ?? null, input.isActive ?? null],
    );

    if (!rows[0]) return refuse("That item is not on this property's list.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ══════════════════════════════════════════════════════════════════
   THE DOCKETS
   ══════════════════════════════════════════════════════════════════ */

/* The select every docket read shares. `still_out` is the hotel's linen
   question and the guest's alike - what went out minus what came back. */
const DOCKET_FIELDS = `
  d.id::text,
  d.number,
  d.belongs_to,
  d.reservation_id::text,
  d.status,
  d.business_date::text,
  app.hotel_clock(d.hotel_id, d.collected_at) as collected_at,
  app.hotel_clock(d.hotel_id, d.returned_at)  as returned_at,
  d.notes,
  d.charge_posting_id::text,
  app.laundry_docket_total(d.id)::text as total,
  (select coalesce(sum(l.quantity), 0) from laundry_docket_lines l
    where l.docket_id = d.id)                                    as pieces,
  (select coalesce(sum(l.quantity - l.returned_quantity), 0) from laundry_docket_lines l
    where l.docket_id = d.id)                                    as still_out,
  (select count(*) from laundry_docket_lines l
    where l.docket_id = d.id and l.unit_price is null)           as unpriced_lines,
  r.reference        as stay_reference,
  g.full_name        as guest_name,
  rm.number          as room_number`;

/* The room comes from `room_assignments`, not from the reservation - the
   front desk's own read (api/src/modules/front-desk/stays.ts) says why:
   one assignment per stay, the one still held first and then the most
   recent, so a room MOVE shows the room the guest is in now. */
const DOCKET_JOINS = `
  from laundry_dockets d
  left join reservations r on r.id = d.reservation_id
  left join guests       g on g.id = r.guest_id
  left join lateral (
    select rm2.number
      from room_assignments ra
      join rooms rm2 on rm2.id = ra.room_id
     where ra.reservation_id = r.id
     order by ra.released_at desc nulls first, ra.from_date desc
     limit 1
  ) rm on true`;

interface DocketRow {
  id: string; number: string; belongs_to: string;
  reservation_id: string | null; status: string; business_date: string;
  collected_at: string | null; returned_at: string | null;
  notes: string | null; charge_posting_id: string | null;
  total: string | null; pieces: string; still_out: string;
  unpriced_lines: string;
  stay_reference: string | null; guest_name: string | null;
  room_number: string | null;
}

const asDocket = (d: DocketRow) => ({
  id: d.id,
  number: d.number,
  /* D18-5. Not a tag on the end of the object - the first thing about it. */
  belongsTo: d.belongs_to as "guest" | "hotel",
  stayId: d.reservation_id,
  stayReference: d.stay_reference,
  guestName: d.guest_name,
  roomNumber: d.room_number,
  status: d.status,
  businessDate: d.business_date,
  collectedAt: d.collected_at,
  returnedAt: d.returned_at,
  notes: d.notes,
  /* Null when the bag is empty or anything in it is unpriced. A dash. */
  total: d.total === null ? null : Number(d.total),
  pieces: Number(d.pieces),
  stillOut: Number(d.still_out),
  unpricedLines: Number(d.unpriced_lines),
  charged: d.charge_posting_id !== null,
});

laundry.get("/:code/laundry/dockets", async (c) => {
  const whose = c.req.query("whose");
  const status = c.req.query("status");

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<DocketRow>(
      `select ${DOCKET_FIELDS} ${DOCKET_JOINS}
        where d.hotel_id = $1
          and ($2::text is null or d.belongs_to = $2)
          and ($3::text is null or d.status = $3)
        order by d.business_date desc, d.number desc
        limit 500`,
      [hotelId,
       whose === "guest" || whose === "hotel" ? whose : null,
       status === "open" || status === "returned" || status === "cancelled" ? status : null],
    );

    return {
      businessDate: await businessDateFor(client, hotelId),
      nextNumber: (await client.query<{ n: string }>(
        "select app.next_laundry_docket_number($1) as n", [hotelId])).rows[0]!.n,
      dockets: rows.map(asDocket),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

laundry.get("/:code/laundry/dockets/:id", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<DocketRow>(
      `select ${DOCKET_FIELDS} ${DOCKET_JOINS}
        where d.hotel_id = $1 and d.id = $2::uuid`,
      [hotelId, c.req.param("id")],
    );
    if (!rows[0]) return null;

    const { rows: lines } = await client.query<{
      id: string; description: string; service: string;
      quantity: number; returned_quantity: number; unit_price: string | null;
    }>(
      `select id::text, description, service, quantity, returned_quantity,
              unit_price::text
         from laundry_docket_lines
        where docket_id = $1::uuid
        order by created_at, id`,
      [c.req.param("id")],
    );

    return {
      ...asDocket(rows[0]),
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        service: l.service,
        quantity: l.quantity,
        returnedQuantity: l.returned_quantity,
        stillOut: l.quantity - l.returned_quantity,
        /* Unpriced at collection stays unpriced here. A dash. */
        unitPrice: l.unit_price === null ? null : Number(l.unit_price),
      })),
    };
  });

  if (!body) return c.json({ error: "No such docket." }, 404);
  return c.json(body);
});

interface LineInput {
  priceItemId?: string; description?: string;
  service?: string; quantity?: number;
}

laundry.post("/:code/laundry/dockets", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as {
    belongsTo?: string; stayId?: string; notes?: string;
    collectedAt?: string; businessDate?: string; lines?: LineInput[];
  };

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* D18-5 AT THE DOOR. Not a default, not "guest unless told otherwise":
       whoever writes a docket says whose bag it is, or there is no docket. */
    const whose = input.belongsTo;
    if (whose !== "guest" && whose !== "hotel") {
      return refuse("Say whose this is: a guest's, or the hotel's own linen.");
    }
    if (whose === "guest" && !input.stayId) {
      return refuse("A guest's docket names the stay it belongs to.");
    }
    if (whose === "hotel" && input.stayId) {
      return refuse("The hotel's own linen does not belong to a stay.");
    }

    const lines = (input.lines ?? []).filter((l) => (l.quantity ?? 0) > 0);
    if (!lines.length) return refuse("A docket needs at least one thing in it.");

    if (whose === "guest") {
      const { rows } = await client.query<{ status: string }>(
        "select status from reservations where hotel_id = $1 and id = $2::uuid",
        [hotelId, input.stayId],
      );
      const stay = rows[0];
      if (!stay) return refuse("That stay is not at this property.");
      if (stay.status === "cancelled") return refuse("That booking was cancelled.");
      if (stay.status === "checked_out") {
        return refuse("That guest has checked out. Reopen the stay to charge to it.");
      }
    }

    const businessDate = await resolveDate(client, hotelId, input.businessDate);

    const { rows: made } = await client.query<{ id: string; number: string }>(
      `insert into laundry_dockets
         (hotel_id, number, belongs_to, reservation_id, business_date,
          collected_at, notes, created_by)
       values ($1, app.next_laundry_docket_number($1), $2, $3::uuid, $4::date,
               coalesce(app.hotel_moment($1, $5), now()), $6,
               app.current_user_id())
       returning id::text, number`,
      [hotelId, whose, whose === "guest" ? input.stayId : null, businessDate,
       input.collectedAt ?? null, input.notes?.trim() || null],
    );
    const docket = made[0]!;

    for (const line of lines) {
      /* The description and the price are COPIED from the list now. A
         rename or a re-price next month does not rewrite this bag. */
      const { rows: priced } = line.priceItemId
        ? await client.query<{ name: string; service: string; price: string | null }>(
            `select name, service, price::text from laundry_price_items
              where hotel_id = $1 and id = $2::uuid and is_active`,
            [hotelId, line.priceItemId])
        : { rows: [] as Array<{ name: string; service: string; price: string | null }> };

      const from = priced[0];
      if (line.priceItemId && !from) {
        return refuse("Something on this docket is no longer on the price list.");
      }

      const description = (from?.name ?? line.description ?? "").trim();
      const service = from?.service ?? line.service;
      if (!description) return refuse("Every line needs to say what it is.");
      if (!service || !SERVICES.includes(service)) {
        return refuse("Every line needs wash, press or dry-clean.");
      }

      await client.query(
        `insert into laundry_docket_lines
           (hotel_id, docket_id, price_item_id, description, service,
            quantity, unit_price)
         values ($1, $2::uuid, $3::uuid, $4, $5, $6::int, $7::numeric)`,
        [hotelId, docket.id, line.priceItemId ?? null, description, service,
         Math.trunc(line.quantity!),
         /* Unpriced on the list means unpriced on the docket. Never 0. */
         from?.price ?? null],
      );
    }

    return { ok: true as const, data: { id: docket.id, number: docket.number } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── What came back ───────────────────────────────────────────────
   The hotel's linen and a guest's bag on one mechanism (the brief, 5):
   what went out, what came back, what is still out. Counts only. */
laundry.post("/:code/laundry/dockets/:id/return", async (c) => {
  const input = (await c.req.json().catch(() => ({}))) as {
    returned?: Array<{ lineId?: string; quantity?: number }>;
    returnedAt?: string;
  };

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ status: string }>(
      "select status from laundry_dockets where hotel_id = $1 and id = $2::uuid",
      [hotelId, c.req.param("id")],
    );
    const docket = rows[0];
    if (!docket) return refuse("No such docket.");
    if (docket.status === "cancelled") return refuse("That docket was cancelled.");

    for (const back of input.returned ?? []) {
      if (!back.lineId || back.quantity === undefined) continue;
      const { rows: done } = await client.query<{ id: string }>(
        /* The table refuses more back than went out; this names the line
           that could not take it rather than letting 23514 through raw. */
        `update laundry_docket_lines
            set returned_quantity = $3::int
          where docket_id = $1::uuid and id = $2::uuid
            and $3::int between 0 and quantity
          returning id::text`,
        [c.req.param("id"), back.lineId, Math.trunc(back.quantity)],
      );
      if (!done[0]) {
        return refuse("More has come back than ever went out. Check the counts.");
      }
    }

    /* Returned when nothing is still out - worked out, never typed. */
    const { rows: [state] } = await client.query<{ still_out: string }>(
      `select coalesce(sum(quantity - returned_quantity), 0)::text as still_out
         from laundry_docket_lines where docket_id = $1::uuid`,
      [c.req.param("id")],
    );

    const complete = Number(state!.still_out) === 0;
    await client.query(
      `update laundry_dockets
          set status      = case when $3::boolean then 'returned' else 'open' end,
              returned_at = case when $3::boolean
                                 then coalesce(app.hotel_moment($1, $4), now())
                                 else null end
        where hotel_id = $1 and id = $2::uuid`,
      [hotelId, c.req.param("id"), complete, input.returnedAt ?? null],
    );

    return { ok: true as const, data: { stillOut: Number(state!.still_out) } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

laundry.post("/:code/laundry/dockets/:id/cancel", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{ id: string }>(
      `update laundry_dockets set status = 'cancelled', returned_at = null
        where hotel_id = $1 and id = $2::uuid and charge_posting_id is null
        returning id::text`,
      [hotelId, c.req.param("id")],
    );
    if (!rows[0]) {
      return refuse(
        "That docket is either not here or already on the bill. A charge is "
        + "reversed on the folio, not by cancelling the docket.");
    }
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ══════════════════════════════════════════════════════════════════
   THE CHARGE — through finance's door, and nowhere else

   D18-7: a guest's docket goes straight onto the room bill as its own
   line, and the Extra Charges report already reads `category = 'laundry'`
   (api/src/modules/reports/builders/manager.ts, EXTRA_KINDS).

   THIS FILE DOES NOT INSERT INTO `folio_postings`. The brief forbids it
   and the parallel plan's rule 2 forbids it: a charge reaches a bill
   through a front door. `api/src/modules/finance/index.ts` exports its
   routers and nothing else today, so there is no function to call - and
   an HTTP call from the server to its own endpoint is not a front door,
   it is a way around one.

   IT IS `postCharge`, on finance's front door since 18 September —
   exactly the function this chat asked for in MODULE.md's Requests, down
   to the argument list. ⚠ AND FOR THREE DAYS NOBODY CONNECTED IT. The
   door was built for this route and the spa, and the master never came
   back to say it existed; the route went on refusing with "finance's door
   does not hand out a way to post a charge" while that door stood open.
   Found by an audit on 21 September (root MEMORY 308).

   So: this route is the call now. `charge_posting_id` is set on the
   docket, and the database's own trigger (`laundry_charge_needs_a_total`)
   still refuses the whole thing if anything in the bag is unpriced.
   Laundry follows the ROOM tax rule (D18-21 gave the spa its own; laundry
   has none), so `taxKind` is left alone.

   THE ROW IS LOCKED FIRST. Two clerks pressing Charge at the same moment
   would otherwise both read "not charged", both post, and put the same
   bag on the bill twice; the second now waits for the first and then
   reads "already on the bill".
   ══════════════════════════════════════════════════════════════════ */
laundry.post("/:code/laundry/dockets/:id/charge", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      belongs_to: string; status: string; charged: boolean; total: string | null;
      reservation_id: string | null; number: string;
    }>(
      `select d.belongs_to, d.status, d.number,
              d.reservation_id::text as reservation_id,
              d.charge_posting_id is not null as charged,
              app.laundry_docket_total(d.id)::text as total
         from laundry_dockets d
        where d.hotel_id = $1 and d.id = $2::uuid
          for update of d`,
      [hotelId, c.req.param("id")],
    );
    const docket = rows[0];
    if (!docket) return refuse("No such docket.");

    /* Every refusal that is this service's own is made here, so that the
       day the door arrives only the posting itself is new. */
    if (docket.belongs_to !== "guest") {
      return refuse("The hotel's own linen is not charged to anybody.");
    }
    if (docket.status === "cancelled") return refuse("That docket was cancelled.");
    if (docket.charged) return refuse("That docket is already on the bill.");
    if (docket.total === null) {
      return refuse("Something in this bag has no price yet. Price it first.");
    }

    /* WHAT THE GUEST READS ON THE BILL: the docket number and what was
       in the bag, so a guest asking "what is this ₹270?" at check-out is
       answered by the line itself. */
    const { rows: lines } = await client.query<{
      description: string; service: string; quantity: number;
    }>(
      `select description, service, quantity from laundry_docket_lines
        where hotel_id = $1 and docket_id = $2::uuid
        order by description`,
      [hotelId, c.req.param("id")],
    );
    const inTheBag = lines
      .map((l) => `${l.quantity} x ${l.description} (${l.service})`)
      .join(", ");

    /* ⚠ A REFUSAL HERE IS SAFE, and it is worth knowing why: every one of
       postCharge's refusals comes before its own insert, so returning it
       commits nothing (MEMORY 243). A cancelled or checked-out stay, a
       closed bill, a property with no room tax rule — each is its own
       sentence and reaches the screen as it is. */
    const posted = await postCharge(client, hotelId, docket.reservation_id!, {
      description: `Laundry ${docket.number}${inTheBag ? `: ${inTheBag}` : ""}`.slice(0, 240),
      amount: Number(docket.total),
      category: "Laundry",
    });
    if (!posted.ok) return refuse(posted.reason);

    /* If THIS raises — the trigger finding an unpriced line after all —
       the whole transaction rolls back, the posting with it. */
    await client.query(
      `update laundry_dockets set charge_posting_id = $3
        where hotel_id = $1 and id = $2::uuid`,
      [hotelId, c.req.param("id"), posted.id],
    );
    return { ok: true as const, data: { postingId: posted.id } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
