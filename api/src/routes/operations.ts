import { Hono } from "hono";
import { withSession, type Session } from "../auth.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FLOWS THAT WRITE

   Everything before this read. This is the first route that changes
   something a guest would notice, and the checkpoint it belongs to is
   measured by one sentence:

       check a guest in, reload the browser, they are still checked in.

   Two things make that safe rather than merely possible.

   ONE TRANSACTION PER REQUEST. `withSession` already opens one, so a
   check-in that assigns a room and moves a status either does both or
   does neither. A half-applied check-in leaves a room held by a
   booking that never arrived.

   THE DATABASE REFUSES, NOT THE BROWSER. `src/lib/rules.ts` still
   disables the button — that is what a clerk should see — but the
   rule is enforced here too. A rule enforced only in the browser is a
   suggestion, and a suggestion is not what stops a room being sold
   twice.
   ══════════════════════════════════════════════════════════════════ */

export const operations = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/** Rule 6's shape, all the way down. Refused is a result, not an error. */
type Outcome<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; reason: string };

const refuse = (reason: string): Outcome => ({ ok: false, reason });

interface CheckInBody {
  roomNumber?: string;
  adults?: number;
  children?: number;
  ratePlan?: string;
  idCaptured?: boolean;
  idSkipReason?: string;
  businessDate?: string;
  user?: string;
}

operations.post("/:code/stays/:id/check-in", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as CheckInBody;
  const stayId = c.req.param("id");

  const result = await withSession(
    c.get("subject"),
    async (client, session: Session): Promise<Outcome | null> => {
      const hotelId = await hotelIdFor(client, c.req.param("code"));
      if (!hotelId) return null;

      /* FOR UPDATE. Two clerks checking the same booking in at once
         would otherwise both read `confirmed`, both write `checked_in`,
         and both assign a room — leaving two assignments on one
         reservation. The second waits here and then finds the status
         already moved. */
      const { rows } = await client.query<{
        id: string;
        status: string;
        check_in: string;
        check_out: string;
        room_type_id: string;
        notes: string | null;
      }>(
        `select id, status, check_in::text, check_out::text, room_type_id, notes
           from reservations
          where hotel_id = $1 and id = $2
          for update`,
        [hotelId, stayId],
      );

      const stay = rows[0];
      if (!stay) return refuse("Reservation not found.");

      if (stay.status === "checked_in") return refuse("Already checked in.");
      if (stay.status === "checked_out") return refuse("This stay has already departed.");
      if (stay.status === "cancelled") return refuse("This booking was cancelled.");
      if (stay.status === "no_show") return refuse("This booking was marked a no-show.");
      if (stay.status !== "confirmed") return refuse("Only a confirmed booking can be checked in.");

      const businessDate = body.businessDate ?? stay.check_in;
      if (stay.check_in > businessDate) {
        return refuse(
          `This booking arrives on ${stay.check_in}. It cannot be checked in early.`,
        );
      }

      if (!body.idCaptured && !body.idSkipReason?.trim()) {
        return refuse("Capture the guest's ID, or give a reason for skipping it.");
      }

      const roomNumber = body.roomNumber?.trim();
      if (!roomNumber) return refuse("Choose a room.");

      const { rows: roomRows } = await client.query<{
        id: string;
        room_type_id: string;
        housekeeping_status: string;
      }>(
        `select id, room_type_id, housekeeping_status
           from rooms
          where hotel_id = $1 and number = $2 and is_active`,
        [hotelId, roomNumber],
      );
      const room = roomRows[0];
      if (!room) return refuse("That room is not part of this property.");

      if (room.housekeeping_status === "out_of_service") {
        return refuse("That room is held out of service.");
      }
      if (room.housekeeping_status === "dirty") {
        return refuse("That room has not been cleaned yet.");
      }
      if (room.room_type_id !== stay.room_type_id) {
        return refuse("That room is a different type from the one booked.");
      }

      /* The room must be free for the WHOLE stay, not merely tonight.
         The EXCLUDE constraint on room_assignments would catch an
         overlap anyway — but it would arrive as a constraint name, and
         a clerk needs a sentence. */
      const { rows: clash } = await client.query<{ reference: string }>(
        `select r.reference
           from room_assignments ra
           join reservations r on r.id = ra.reservation_id
          where ra.room_id = $1
            and ra.released_at is null
            and ra.reservation_id <> $2
            and daterange(ra.from_date, greatest(ra.to_date, ra.from_date + 1), '[)')
                && daterange($3::date, greatest($4::date, $3::date + 1), '[)')
          limit 1`,
        [room.id, stayId, stay.check_in, stay.check_out],
      );
      if (clash[0]) {
        return refuse(`Room ${roomNumber} is held by ${clash[0].reference} for part of that stay.`);
      }

      const notes = body.idCaptured
        ? stay.notes
        : [stay.notes, `ID not captured — ${body.idSkipReason}`]
            .filter(Boolean)
            .join(" · ");

      await client.query(
        `update reservations
            set status = 'checked_in',
                adults = coalesce($3, adults),
                children = coalesce($4, children),
                occupancy = coalesce($3, adults) + coalesce($4, children),
                meal_plan = coalesce($5, meal_plan),
                notes = $6
          where hotel_id = $1 and id = $2`,
        [hotelId, stayId, body.adults ?? null, body.children ?? null,
         body.ratePlan === "Room Only" ? "RO" : body.ratePlan ?? null, notes],
      );

      /* Replace rather than add. A booking pre-assigned to one room and
         checked into another must not end up holding both. */
      await client.query(
        `update room_assignments set released_at = now()
          where reservation_id = $1 and released_at is null and room_id <> $2`,
        [stayId, room.id],
      );
      await client.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1, $2, $3, $4, $5, 'arrival')
         on conflict do nothing`,
        [hotelId, stayId, room.id, stay.check_in, stay.check_out],
      );

      await client.query(
        "update rooms set occupancy_status = 'occupied' where id = $1",
        [room.id],
      );

      void session;
      return { ok: true };
    },
  );

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ══════════════════════════════════════════════════════════════════
   THE LEDGER

   Append-only, enforced by a trigger — `folio_postings_append_only`.
   A wrong charge is REVERSED with a second row; nothing is edited and
   nothing is deleted. That means `count(*)` goes UP when something is
   undone, which is the opposite of what most people expect and exactly
   what makes the ledger auditable.

   Every posting needs a folio. A reservation has one from check-in, so
   `folioFor` opens one on demand rather than failing on a stay that has
   not been billed yet — an empty folio is a normal state.
   ══════════════════════════════════════════════════════════════════ */

async function folioFor(
  client: Client, hotelId: string, stayId: string,
): Promise<string | null> {
  const { rows: existing } = await client.query<{ id: string }>(
    "select id from folios where hotel_id = $1 and reservation_id = $2 limit 1",
    [hotelId, stayId],
  );
  if (existing[0]) return existing[0].id;

  const { rows: res } = await client.query(
    "select 1 from reservations where hotel_id = $1 and id = $2",
    [hotelId, stayId],
  );
  if (!res.length) return null;

  const { rows: made } = await client.query<{ id: string }>(
    `insert into folios (hotel_id, reservation_id, status)
     values ($1, $2, 'open') returning id`,
    [hotelId, stayId],
  );
  return made[0]?.id ?? null;
}

/** The interface's categories, and the schema's. */
const CATEGORY: Record<string, string> = {
  Room: "room", "Room posting": "room",
  Food: "food", Beverage: "beverage", Beverages: "beverage",
  Spa: "spa", Laundry: "laundry", Minibar: "minibar",
  Telephone: "telephone", Miscellaneous: "misc", Misc: "misc",
  Discount: "discount", Payment: "payment", Refund: "refund",
};

const PAYMENT_METHOD: Record<string, string> = {
  Cash: "cash", UPI: "upi", "Credit Card": "card", "Debit Card": "card",
  "Net Banking": "netbanking", Wallet: "wallet", Cheque: "cheque",
  "Bank Transfer": "bank_transfer", "Bill to company": "city_ledger",
  "Room Posting": "city_ledger",
};

/* ── Post a charge ───────────────────────────────────────────────── */

operations.post("/:code/stays/:id/charges", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    category?: string; description?: string; amount?: number;
    taxable?: boolean; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const description = body.description?.trim();
    if (!description) return refuse("A charge needs a description.");
    if (!body.amount) return refuse("A charge of zero is not a charge.");

    const { rows } = await client.query<{ status: string }>(
      "select status from reservations where hotel_id = $1 and id = $2",
      [hotelId, c.req.param("id")],
    );
    const stay = rows[0];
    if (!stay) return refuse("Reservation not found.");
    if (stay.status === "cancelled") return refuse("This booking was cancelled.");
    if (stay.status === "checked_out") {
      return refuse("This folio is closed. Reopen the stay to post to it.");
    }

    const folioId = await folioFor(client, hotelId, c.req.param("id"));
    if (!folioId) return refuse("Could not open a folio for this stay.");

    /* The property's own rate, not a constant. GST is a state subject
       and a property that crosses the tariff threshold moves to 9+9. */
    const { rows: rate } = await client.query<{ total: string }>(
      "select (cgst_rate + sgst_rate)::text as total from hotels where id = $1",
      [hotelId],
    );
    const taxRate = body.taxable ? Number(rate[0]?.total ?? 5) : 0;
    const amount = Math.round(body.amount * 100) / 100;
    const taxAmount = Math.round(amount * taxRate) / 100;

    const { rows: made } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id::text`,
      [hotelId, folioId, body.businessDate ?? new Date().toISOString().slice(0, 10),
       CATEGORY[body.category ?? "Miscellaneous"] ?? "misc",
       description, amount, taxRate, taxAmount],
    );

    return { ok: true, data: { id: made[0]?.id } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Reverse one ─────────────────────────────────────────────────── */

operations.post("/:code/stays/:id/charges/:postingId/reverse", async (c) => {
  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const postingId = c.req.param("postingId");

    const { rows } = await client.query<{
      id: string; folio_id: string; business_date: string; category: string;
      description: string; amount: string; tax_rate: string; tax_amount: string;
      reverses_id: string | null; already: boolean;
    }>(
      `select fp.id::text, fp.folio_id, fp.business_date::text, fp.category,
              fp.description, fp.amount, fp.tax_rate, fp.tax_amount,
              fp.reverses_id::text,
              exists (select 1 from folio_postings r where r.reverses_id = fp.id) as already
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where f.hotel_id = $1 and f.reservation_id = $2 and fp.id = $3::bigint`,
      [hotelId, c.req.param("id"), postingId],
    );

    const p = rows[0];
    if (!p) return refuse("Posting not found.");
    if (p.already) return refuse("That posting has already been reversed.");
    if (p.reverses_id) return refuse("A reversal cannot itself be reversed.");

    /* The reversal is its OWN row, pointing at what it undoes. The
       original stays exactly as it was — that is the whole point of an
       append-only ledger, and it is why the posting count goes UP.

       No lock. `pms_app` has no UPDATE on this table (append-only), so
       `SELECT ... FOR UPDATE` is refused outright — the permission was
       telling me the lock was the wrong tool. Migration 021 puts a
       unique index on `reverses_id` instead, so two concurrent
       reversals leave one inserted and one refused by the database. */
    try {
      const { rows: made } = await client.query<{ id: string }>(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, reverses_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint)
         returning id::text`,
        [hotelId, p.folio_id, p.business_date, p.category,
         `Reversal — ${p.description}`,
         -Number(p.amount), p.tax_rate, -Number(p.tax_amount), postingId],
      );
      return { ok: true, data: { id: made[0]?.id } };
    } catch (error) {
      /* The index caught a second reversal. That is a refusal a clerk
         can act on, not a server error — somebody else got there
         first, and the credit is already on the folio. */
      if ((error as { code?: string }).code === "23505") {
        return refuse("That posting has already been reversed.");
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Take a payment ──────────────────────────────────────────────── */

operations.post("/:code/stays/:id/payments", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    method?: string; amount?: number; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (!body.amount || body.amount <= 0) {
      return refuse("A payment must be greater than zero.");
    }
    const method = PAYMENT_METHOD[body.method ?? "Cash"];
    if (!method) return refuse(`"${body.method}" is not a payment method.`);

    const folioId = await folioFor(client, hotelId, c.req.param("id"));
    if (!folioId) return refuse("Reservation not found.");

    /* A payment is a NEGATIVE posting. The balance is the sum of the
       ledger, so money received reduces it by being part of the sum —
       there is no separate "paid" column to keep in step. */
    const { rows: made } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,'payment',$4,$5,0,0)
       returning id::text`,
      [hotelId, folioId,
       body.businessDate ?? new Date().toISOString().slice(0, 10),
       method === "city_ledger"
         ? "Transferred to city ledger"
         : `Received — ${body.method}`,
       -Math.round(body.amount * 100) / 100],
    );

    await client.query(
      `insert into payments (hotel_id, posting_id, method, amount)
       values ($1, $2::bigint, $3, $4)`,
      [hotelId, made[0]?.id, method, Math.round(body.amount * 100) / 100],
    );

    return { ok: true, data: { id: made[0]?.id } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Check out ───────────────────────────────────────────────────── */

operations.post("/:code/stays/:id/check-out", async (c) => {
  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const stayId = c.req.param("id");

    const { rows } = await client.query<{ status: string }>(
      `select status from reservations
        where hotel_id = $1 and id = $2 for update`,
      [hotelId, stayId],
    );
    const stay = rows[0];
    if (!stay) return refuse("Reservation not found.");
    if (stay.status === "checked_out") return refuse("This stay has already departed.");
    if (stay.status !== "checked_in") return refuse("Only a checked-in guest can check out.");

    /* The balance decides. A guest cannot walk out owing money without
       somebody deciding to let them — and that decision is a transfer
       to the city ledger, which is itself a posting. */
    const { rows: bal } = await client.query<{ balance: string }>(
      `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as balance
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where f.hotel_id = $1 and f.reservation_id = $2
          and fp.reverses_id is null
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`,
      [hotelId, stayId],
    );
    const balance = Math.round(Number(bal[0]?.balance ?? 0) * 100) / 100;

    if (balance > 0.5) {
      return refuse(
        `₹${balance.toLocaleString("en-IN")} is still outstanding. Settle the folio, ` +
          `or transfer it to the city ledger, before checking out.`,
      );
    }
    if (balance < -0.5) {
      return refuse(
        `The guest has overpaid by ₹${Math.abs(balance).toLocaleString("en-IN")}. ` +
          `Refund it before checking out.`,
      );
    }

    const { rows: room } = await client.query<{ id: string; number: string }>(
      `select rm.id, rm.number
         from room_assignments ra
         join rooms rm on rm.id = ra.room_id
        where ra.reservation_id = $1 and ra.released_at is null
        limit 1`,
      [stayId],
    );

    await client.query(
      "update reservations set status = 'checked_out' where hotel_id = $1 and id = $2",
      [hotelId, stayId],
    );
    await client.query(
      "update folios set status = 'closed', closed_at = now() where hotel_id = $1 and reservation_id = $2",
      [hotelId, stayId],
    );

    if (room[0]) {
      /* The room releases, becomes vacant, and becomes DIRTY — which is
         how it reaches housekeeping's board the moment the guest walks
         out, rather than the next time somebody remembers. */
      await client.query(
        "update room_assignments set released_at = now() where reservation_id = $1 and released_at is null",
        [stayId],
      );
      await client.query(
        `update rooms set occupancy_status = 'vacant', housekeeping_status = 'dirty'
          where id = $1`,
        [room[0].id],
      );
    }

    return { ok: true, data: { room: room[0]?.number ?? null } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});


/* ── A walk-in ────────────────────────────────────────────────────
   One act, not a booking followed by a check-in. The guest is at the
   desk; they arrive checked in, in a room, with the first night on
   the folio.

   It creates a GUEST too. There is no guest record to look up — that
   is what "walk-in" means — and the schema requires one, correctly: a
   reservation without a guest is a room held for nobody.
   ═══════════════════════════════════════════════════════════════ */

operations.post("/:code/walk-ins", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    guestName?: string; roomNumber?: string; nights?: number;
    adults?: number; children?: number; ratePlan?: string;
    rackTariff?: number; offeredTariff?: number;
    overrideReason?: string; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const guestName = body.guestName?.trim();
    if (!guestName) return refuse("A walk-in needs a guest name.");

    const nights = body.nights ?? 1;
    if (nights < 1) return refuse("A stay is at least one night.");

    const roomNumber = body.roomNumber?.trim();
    if (!roomNumber) return refuse("Choose a room.");

    const businessDate = body.businessDate ?? new Date().toISOString().slice(0, 10);

    const { rows: roomRows } = await client.query<{
      id: string; room_type_id: string; housekeeping_status: string;
      occupancy_status: string; base_rate: string;
    }>(
      `select rm.id, rm.room_type_id, rm.housekeeping_status,
              rm.occupancy_status, rt.base_rate
         from rooms rm
         join room_types rt on rt.id = rm.room_type_id
        where rm.hotel_id = $1 and rm.number = $2 and rm.is_active`,
      [hotelId, roomNumber],
    );
    const room = roomRows[0];
    if (!room) return refuse("That room is not part of this property.");
    if (room.housekeeping_status === "out_of_service") {
      return refuse("That room is held out of service.");
    }
    if (room.housekeeping_status === "dirty") {
      return refuse("That room has not been cleaned yet.");
    }
    if (room.occupancy_status === "occupied") {
      return refuse("Somebody is already in that room.");
    }

    const departure = new Date(`${businessDate}T00:00:00Z`);
    departure.setUTCDate(departure.getUTCDate() + nights);
    const checkOut = departure.toISOString().slice(0, 10);

    /* The room must be free for the whole stay, not merely tonight. */
    const { rows: clash } = await client.query<{ reference: string }>(
      `select r.reference
         from room_assignments ra
         join reservations r on r.id = ra.reservation_id
        where ra.room_id = $1 and ra.released_at is null
          and daterange(ra.from_date, greatest(ra.to_date, ra.from_date + 1), '[)')
              && daterange($2::date, $3::date, '[)')
        limit 1`,
      [room.id, businessDate, checkOut],
    );
    if (clash[0]) {
      return refuse(`Room ${roomNumber} is held by ${clash[0].reference} for part of that stay.`);
    }

    const { rows: guestRows } = await client.query<{ id: string }>(
      "insert into guests (full_name) values ($1) returning id",
      [guestName],
    );

    /* The per-hotel reference sequence. `nextReference()` in the store
       generated one client-side, which cannot stay unique once two
       clerks are taking walk-ins at the same desk. */
    const { rows: refRows } = await client.query<{ reference: string }>(
      `select 'FH-' || to_char(now(), 'YYMM') || '-' ||
              lpad((coalesce(max(substring(reference from '[0-9]+$')::int), 5000) + 1)::text, 4, '0')
              as reference
         from reservations where hotel_id = $1`,
      [hotelId],
    );

    const offered = body.offeredTariff ?? Number(room.base_rate);
    const notes = body.overrideReason?.trim()
      ? `Rate override — ${body.overrideReason.trim()}`
      : null;

    const { rows: made } = await client.query<{ id: string }>(
      `insert into reservations
         (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
          adults, children, occupancy, agreed_rate, status, source,
          meal_plan, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'checked_in','walk_in',$11,$12)
       returning id`,
      [hotelId, refRows[0]?.reference, guestRows[0]?.id, room.room_type_id,
       businessDate, checkOut, body.adults ?? 1, body.children ?? 0,
       (body.adults ?? 1) + (body.children ?? 0), offered,
       body.ratePlan === "Room Only" ? "RO" : body.ratePlan ?? null, notes],
    );
    const stayId = made[0]!.id;

    /* 'arrival', not 'walk_in'. ra_reason_valid does not list the
       latter and should not: a walk-in IS an arrival — the guest turns
       up and is given a room. The reason records what happened to the
       ROOM, not how the booking was taken.

       (Comment outside the template literal. A backtick inside one
       ends it — that is the second time, so: no backticks in SQL.) */
    await client.query(
      `insert into room_assignments
         (hotel_id, reservation_id, room_id, from_date, to_date, reason)
       values ($1,$2,$3,$4,$5,'arrival')`,
      [hotelId, stayId, room.id, businessDate, checkOut],
    );
    await client.query(
      "update rooms set occupancy_status = 'occupied' where id = $1",
      [room.id],
    );

    const { rows: folio } = await client.query<{ id: string }>(
      `insert into folios (hotel_id, reservation_id, status)
       values ($1, $2, 'open') returning id`,
      [hotelId, stayId],
    );

    const { rows: rate } = await client.query<{ total: string }>(
      "select (cgst_rate + sgst_rate)::text as total from hotels where id = $1",
      [hotelId],
    );
    const amount = Math.round(offered * nights * 100) / 100;
    const taxRate = Number(rate[0]?.total ?? 5);

    await client.query(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,'room',$4,$5,$6,$7)`,
      [hotelId, folio[0]?.id, businessDate,
       `Room ${roomNumber} · ${nights} night${nights === 1 ? "" : "s"}`,
       amount, taxRate, Math.round(amount * taxRate) / 100],
    );

    return { ok: true, data: { id: stayId, reference: refRows[0]?.reference } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
